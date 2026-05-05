import { NextRequest, NextResponse } from 'next/server'
import { readSession, writeSession } from '@/lib/upload-sessions'

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

  const { prompt } = await req.json() as { prompt: string }
  if (typeof prompt === 'string') row.prompt = prompt

  writeSession(session)
  return NextResponse.json({ ok: true })
}
