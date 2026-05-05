import { NextRequest, NextResponse } from 'next/server'
import { readCsv, writeCsv } from '@/lib/csv'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sl_no: string }> },
) {
  const { sl_no } = await params
  const { prompt, extra_instructions } = await req.json() as {
    prompt?: string
    extra_instructions?: string
  }

  const rows   = readCsv()
  const target = rows.find(r => r.SL_NO.trim() === sl_no)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (prompt !== undefined)             target.NanoBanana_Prompt    = prompt
  if (extra_instructions !== undefined) target.Extra_Instructions   = extra_instructions

  await writeCsv(rows)
  return NextResponse.json({ ok: true })
}
