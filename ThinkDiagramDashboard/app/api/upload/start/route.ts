import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { writeSession, imagesDir, type UploadSession } from '@/lib/upload-sessions'
import { activeSessions } from '@/lib/upload-jobs'
import { runStage1, runStage2 } from '@/lib/python-bridge'

const CONCURRENCY = 3

interface StartBody {
  column: string
  filename: string
  rows: Record<string, string>[]
}

async function runPool(tasks: (() => Promise<void>)[], limit: number) {
  let i = 0
  async function worker() {
    while (i < tasks.length) {
      const idx = i++
      await tasks[idx]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
}

export async function POST(req: NextRequest) {
  const body = await req.json() as StartBody
  const { column, filename, rows } = body

  if (!column || !rows?.length) {
    return NextResponse.json({ error: 'column and rows are required' }, { status: 400 })
  }

  const id = uuidv4()

  const session: UploadSession = {
    id,
    created_at: new Date().toISOString(),
    column,
    original_filename: filename || 'upload',
    rows: rows.map((r, i) => ({
      index: i,
      value: String(r[column] ?? '').trim(),
      status: 'pending' as const,
      prompt: '',
      image_file: '',
      error: '',
    })).filter(r => r.value !== ''),
  }

  writeSession(session)

  // Fire-and-forget — runs 3 rows concurrently
  ;(async () => {
    if (activeSessions.has(id)) return
    activeSessions.add(id)
    try {
      const tasks = session.rows.map(row => async () => {
        row.status = 'stage1'
        writeSession(session)

        try {
          row.prompt = await runStage1(row.value, '')

          row.status = 'stage2'
          writeSession(session)

          const imgFile = `${String(row.index).padStart(4, '0')}_diagram.png`
          const imgPath = path.join(imagesDir(id), imgFile)
          await runStage2(row.prompt, imgPath)

          row.image_file = imgFile
          row.status     = 'done'
        } catch (e: unknown) {
          row.error  = e instanceof Error ? e.message : String(e)
          row.status = 'error'
        }

        writeSession(session)
      })

      await runPool(tasks, CONCURRENCY)
    } finally {
      activeSessions.delete(id)
    }
  })()

  return NextResponse.json({ session_id: id })
}
