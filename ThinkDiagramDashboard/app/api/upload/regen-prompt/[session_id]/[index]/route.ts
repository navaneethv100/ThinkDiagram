import { NextRequest, NextResponse } from 'next/server'
import { readSession, writeSession } from '@/lib/upload-sessions'
import { runStage1 } from '@/lib/python-bridge'

export const maxDuration = 60

type Params = { session_id: string; index: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { session_id, index } = await params
  const idx = parseInt(index, 10)

  const session = readSession(session_id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const row = session.rows.find(r => r.index === idx)
  if (!row) return NextResponse.json({ error: 'Row not found' }, { status: 404 })

  const { extra_instructions = '' } = await req.json() as { extra_instructions?: string }

  try {
    const prompt = await runStage1(row.value, extra_instructions)

    // Re-read the freshest session before writing — the batch may have updated
    // other rows while Stage 1 was running, and we must not overwrite that progress.
    const fresh = readSession(session_id)
    if (fresh) {
      const freshRow = fresh.rows.find(r => r.index === idx)
      if (freshRow) {
        freshRow.prompt = prompt
        writeSession(fresh)
      }
    }

    return NextResponse.json({ prompt })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
