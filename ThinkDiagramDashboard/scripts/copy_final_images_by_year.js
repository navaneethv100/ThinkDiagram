#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const SESSION_ID = process.argv[2]
if (!SESSION_ID) {
  console.error('Usage: copy_final_images_by_year.js SESSION_ID')
  process.exit(2)
}

const appRoot = process.cwd()
const repoRoot = path.resolve(appRoot, '..')
const sessionDir = path.join(repoRoot, 'uploads', SESSION_ID)
const imageDir = path.join(sessionDir, 'images')
const dataPath = path.join(sessionDir, 'data.json')

const session = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
const finalRows = session.rows.filter((row) => row.status === 'done' && row.image_file)
const years = Array.from(new Set(finalRows
  .map((row) => String(row.year || '').trim() || ((row.image_file || '').match(/_(20\d{2})_/) || [])[1])
  .filter(Boolean)))
  .sort()

const counts = Object.fromEntries(years.map((year) => [year, 0]))
const missing = []
const skipped = []

for (const year of years) {
  const targetDir = path.join(repoRoot, `NewImage${year}`)
  fs.mkdirSync(targetDir, { recursive: true })
  for (const file of fs.readdirSync(targetDir)) {
    if (/\.(png|jpe?g|webp)$/i.test(file)) {
      fs.rmSync(path.join(targetDir, file))
    }
  }
}

for (const row of finalRows) {
  const year = String(row.year || '').trim() || ((row.image_file || '').match(/_(20\d{2})_/) || [])[1]
  if (!year || !years.includes(year)) {
    skipped.push({ index: row.index, image_file: row.image_file, year })
    continue
  }

  const sourcePath = path.join(imageDir, row.image_file)
  if (!fs.existsSync(sourcePath)) {
    missing.push({ index: row.index, image_file: row.image_file })
    continue
  }

  fs.copyFileSync(sourcePath, path.join(repoRoot, `NewImage${year}`, row.image_file))
  counts[year] += 1
}

console.log(JSON.stringify({
  session_id: SESSION_ID,
  final_rows: finalRows.length,
  copied: counts,
  total_copied: Object.values(counts).reduce((sum, value) => sum + value, 0),
  missing,
  skipped,
}, null, 2))
