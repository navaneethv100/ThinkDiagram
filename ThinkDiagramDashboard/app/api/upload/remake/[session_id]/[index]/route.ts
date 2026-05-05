import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { readSession, writeSession, imagesDir } from '@/lib/upload-sessions'
import { runStage2 } from '@/lib/python-bridge'

const g = globalThis as Record<string, unknown>
if (!g.__uploadRemakeJobs) g.__uploadRemakeJobs = new Set<string>()
const remakeJobs = g.__uploadRemakeJobs as Set<string>

type Params = { session_id: string; index: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { session_id, index } = await params
  const idx    = parseInt(index, 10)
  const jobKey = `${session_id}:${idx}`

  if (remakeJobs.has(jobKey)) {
    return NextResponse.json({ error: 'Already generating' }, { status: 409 })
  }

  const { prompt } = await req.json() as { prompt: string }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt required' }, { status: 400 })

  // Mark as stage2 immediately so the UI shows progress
  const session = readSession(session_id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const row = session.rows.find(r => r.index === idx)
  if (!row) return NextResponse.json({ error: 'Row not found' }, { status: 404 })
  row.prompt = prompt
  row.status = 'stage2'
  row.error  = ''
  writeSession(session)

  remakeJobs.add(jobKey)
  ;(async () => {
    try {
      const imgFile = `${String(idx).padStart(4, '0')}_diagram.png`
      const imgPath = path.join(imagesDir(session_id), imgFile)
      await runStage2(prompt, imgPath)

      // Re-read before writing so we don't overwrite other rows' progress
      const fresh = readSession(session_id)
      if (fresh) {
        const freshRow = fresh.rows.find(r => r.index === idx)
        if (freshRow) {
          freshRow.prompt     = prompt
          freshRow.image_file = imgFile
          freshRow.status     = 'done'
          freshRow.error      = ''
          writeSession(fresh)
        }
      }
    } catch (e: unknown) {
      const fresh = readSession(session_id)
      if (fresh) {
        const freshRow = fresh.rows.find(r => r.index === idx)
        if (freshRow) {
          freshRow.error  = e instanceof Error ? e.message : String(e)
          freshRow.status = 'error'
          writeSession(fresh)
        }
      }
    } finally {
      remakeJobs.delete(jobKey)
    }
  })()

  return NextResponse.json({ status: 'started' })
}
