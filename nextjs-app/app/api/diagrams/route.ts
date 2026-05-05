import { NextResponse } from 'next/server'
import { readCsv } from '@/lib/csv'
import { buildFilename } from '@/lib/images'
import { FINAL_DIAGRAMS, CASE_STUDY_CUTOFF } from '@/lib/paths'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const rows = readCsv()
  const out = rows
    .filter(r => {
      const n = parseInt(r.SL_NO.trim())
      return !isNaN(n) && n < CASE_STUDY_CUTOFF
    })
    .map(r => {
      const filename = buildFilename(r)
      const exists = fs.existsSync(path.join(FINAL_DIAGRAMS, filename))
      return {
        sl_no:              r.SL_NO.trim(),
        year:               r.Year.trim(),
        question:           (r.Questions || '').trim(),
        prompt:             (r.NanoBanana_Prompt || '').trim(),
        extra_instructions: (r.Extra_Instructions || '').trim(),
        diagram_name:       (r.Diagram_Name || '').trim(),
        image_file:         exists ? filename : null,
      }
    })
  return NextResponse.json(out)
}
