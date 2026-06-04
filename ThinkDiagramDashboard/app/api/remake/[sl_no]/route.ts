import { NextRequest, NextResponse } from 'next/server'
import { readCsv, writeCsv } from '@/lib/csv'
import { buildFilepath } from '@/lib/images'
import { runStage2 } from '@/lib/python-bridge'
import { diagramJobs } from '@/lib/jobs'
import { BIN_DIR } from '@/lib/paths'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sl_no: string }> },
) {
  const { sl_no } = await params

  if (diagramJobs.get(sl_no)?.status === 'generating')
    return NextResponse.json({ error: 'already generating' }, { status: 409 })

  const { prompt } = await req.json() as { prompt?: string }
  if (!prompt?.trim()) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const rows   = readCsv()
  const target = rows.find(r => r.SL_NO.trim() === sl_no)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const outputPath = buildFilepath(target, prompt)
  diagramJobs.set(sl_no, { status: 'generating' })

  // Fire and forget
  ;(async () => {
    try {
      await runStage2(prompt, outputPath, BIN_DIR)
      const fresh = readCsv()
      const t2    = fresh.find(r => r.SL_NO.trim() === sl_no)
      if (t2) { t2.NanoBanana_Prompt = prompt; await writeCsv(fresh) }
      diagramJobs.set(sl_no, { status: 'done' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      diagramJobs.set(sl_no, { status: `error:${msg}` })
    }
  })()

  return NextResponse.json({ status: 'started' })
}
