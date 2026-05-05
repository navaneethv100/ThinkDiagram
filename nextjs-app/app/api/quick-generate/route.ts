import { NextRequest, NextResponse } from 'next/server'
import { runStage1, runStage2 } from '@/lib/python-bridge'
import { quickJobs } from '@/lib/jobs'
import { QUICK_GENERATED } from '@/lib/paths'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'

export async function POST(req: NextRequest) {
  const { description, diagram_type = '' } = await req.json() as {
    description?: string
    diagram_type?: string
  }
  if (!description?.trim())
    return NextResponse.json({ error: 'description is required' }, { status: 400 })

  const jobId = uuidv4()
  quickJobs.set(jobId, {
    status: 'stage1', stage1_prompt: null, image_file: null, description, diagram_type,
  })

  ;(async () => {
    try {
      const extra    = diagram_type ? `Diagram type: ${diagram_type}` : ''
      const nbPrompt = await runStage1(description, extra)
      quickJobs.set(jobId, { ...quickJobs.get(jobId)!, status: 'stage2', stage1_prompt: nbPrompt })

      fs.mkdirSync(QUICK_GENERATED, { recursive: true })
      const ts       = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15)
      const filename = `quick_${ts}_${jobId.slice(0, 6)}.png`
      const outputPath = path.join(QUICK_GENERATED, filename)

      await runStage2(nbPrompt, outputPath)
      quickJobs.set(jobId, { ...quickJobs.get(jobId)!, status: 'done', image_file: filename })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      quickJobs.set(jobId, { ...quickJobs.get(jobId)!, status: 'error', error: msg })
    }
  })()

  return NextResponse.json({ job_id: jobId })
}
