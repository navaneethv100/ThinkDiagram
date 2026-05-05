import { NextRequest, NextResponse } from 'next/server'
import { readCsv, writeCsv } from '@/lib/csv'
import { runStage1 } from '@/lib/python-bridge'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sl_no: string }> },
) {
  const { sl_no } = await params
  const { extra_instructions = '' } = await req.json() as { extra_instructions?: string }

  const rows  = readCsv()
  const target = rows.find(r => r.SL_NO.trim() === sl_no)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  target.Extra_Instructions = extra_instructions
  await writeCsv(rows)

  try {
    const prompt = await runStage1(target.Questions.trim(), extra_instructions)
    return NextResponse.json({ prompt })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
