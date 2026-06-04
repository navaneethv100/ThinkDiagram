import { NextRequest, NextResponse } from 'next/server'
import { runStage2 } from '@/lib/python-bridge'
import { quickJobs } from '@/lib/jobs'
import { QUICK_GENERATED } from '@/lib/paths'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { buildImageFilename, currentFilenameYear } from '@/lib/images'

export async function POST(req: NextRequest) {
  const { nb_prompt } = await req.json() as { nb_prompt?: string }
  if (!nb_prompt?.trim())
    return NextResponse.json({ error: 'nb_prompt is required' }, { status: 400 })

  const jobId = uuidv4()
  quickJobs.set(jobId, { status: 'stage2', stage1_prompt: nb_prompt, image_file: null })

  ;(async () => {
    try {
      fs.mkdirSync(QUICK_GENERATED, { recursive: true })
      const filename = buildImageFilename({
        id: jobId.slice(0, 8),
        dbId: 'quick',
        year: currentFilenameYear(),
        title: nb_prompt,
      })
      const outputPath = path.join(QUICK_GENERATED, filename)

      await runStage2(nb_prompt, outputPath)
      quickJobs.set(jobId, { ...quickJobs.get(jobId)!, status: 'done', image_file: filename })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      quickJobs.set(jobId, { ...quickJobs.get(jobId)!, status: 'error', error: msg })
    }
  })()

  return NextResponse.json({ job_id: jobId })
}
