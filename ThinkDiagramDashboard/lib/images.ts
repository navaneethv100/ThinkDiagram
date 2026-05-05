import path from 'path'
import fs from 'fs'
import { FINAL_DIAGRAMS } from './paths'
import type { DiagramRow } from './types'

export function buildFilename(row: DiagramRow): string {
  const year  = (row.Year  || '').trim()
  const sl    = (row.SL_NO || '').trim()
  const dname = (row.Diagram_Name || '').trim() || `SL${sl}`
  return `${year}_${sl}_${dname}.png`
}

export function buildFilepath(row: DiagramRow): string {
  return path.join(FINAL_DIAGRAMS, buildFilename(row))
}

export function imageExists(row: DiagramRow): boolean {
  return fs.existsSync(buildFilepath(row))
}
