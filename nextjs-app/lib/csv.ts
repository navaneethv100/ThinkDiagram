import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import fs from 'fs'
import { CSV_FILE } from './paths'
import type { DiagramRow } from './types'

const COLUMNS = ['SL_NO', 'Year', 'Questions', 'NanoBanana_Prompt', 'Diagram_Name', 'Extra_Instructions']

export function readCsv(): DiagramRow[] {
  const content = fs.readFileSync(CSV_FILE, 'utf-8')
  const rows = parse(content, { columns: true, skip_empty_lines: true }) as DiagramRow[]
  // Ensure every row has all columns (handles CSVs missing Extra_Instructions)
  return rows.map(r => ({ ...r, Extra_Instructions: r.Extra_Instructions ?? '' }))
}

// Serialize writes to prevent file corruption under concurrent requests
let writeQueue: Promise<void> = Promise.resolve()

export function writeCsv(rows: DiagramRow[]): Promise<void> {
  writeQueue = writeQueue.then(() => {
    const out = stringify(rows, { header: true, columns: COLUMNS })
    fs.writeFileSync(CSV_FILE, out, 'utf-8')
  })
  return writeQueue
}
