import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { readSession, writeSession, imagesDir } from '@/lib/upload-sessions'
import { activeSessions } from '@/lib/upload-jobs'

const g = globalThis as Record<string, unknown>
if (!g.__uploadRemakeJobs) g.__uploadRemakeJobs = new Set<string>()
const remakeJobs = g.__uploadRemakeJobs as Set<string>

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await params
  const session = readSession(session_id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const imgDir       = imagesDir(session_id)
  const batchRunning = activeSessions.has(session_id)
  let dirty          = false

  for (const row of session.rows) {
    if (row.status !== 'stage1' && row.status !== 'stage2') continue

    const rowJobActive = batchRunning || remakeJobs.has(`${session_id}:${row.index}`)

    // Only auto-heal when nothing is actively running for this row
    if (rowJobActive) continue

    if (row.status === 'stage2') {
      const expectedFile = `${String(row.index).padStart(4, '0')}_diagram.png`
      const imgPath      = path.join(imgDir, expectedFile)

      if (fs.existsSync(imgPath)) {
        // Image landed on disk but the status-write was lost (e.g. HMR restart)
        row.image_file = expectedFile
        row.status     = 'done'
        row.error      = ''
      } else {
        row.status = 'error'
        row.error  = 'Generation was interrupted. Click Re-generate then Remake Image.'
      }
    } else {
      // stage1 with no active job
      row.status = 'error'
      row.error  = 'Generation was interrupted. Click Re-generate then Remake Image.'
    }

    dirty = true
  }

  if (dirty) writeSession(session)
  return NextResponse.json(session)
}
