import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const allowed = ['.csv', '.xlsx', '.xls']
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!allowed.includes(ext)) {
    return NextResponse.json({ error: 'Only CSV and Excel files are supported' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  })

  if (rows.length === 0) {
    return NextResponse.json({ error: 'File is empty or has no data rows' }, { status: 400 })
  }

  const columns = Object.keys(rows[0])
  if (columns.length === 0) {
    return NextResponse.json({ error: 'No columns found in the file' }, { status: 400 })
  }

  const preview = rows.slice(0, 5).map(r =>
    Object.fromEntries(columns.map(c => [c, String(r[c] ?? '')]))
  )

  return NextResponse.json({
    columns,
    preview,
    total: rows.length,
    filename: file.name,
    rows: rows.map(r => Object.fromEntries(columns.map(c => [c, String(r[c] ?? '')]))),
  })
}
