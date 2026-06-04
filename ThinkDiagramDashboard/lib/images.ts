import path from 'path'
import fs from 'fs'
import { FINAL_DIAGRAMS } from './paths'
import type { DiagramRow } from './types'

const MAX_TITLE_SLUG_LENGTH = 90

function safePart(value: string, fallback: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return cleaned || fallback
}

export function currentFilenameYear(): string {
  return String(new Date().getFullYear())
}

export function describeImageFromPrompt(prompt: string): string {
  return safePart(prompt, 'image').slice(0, MAX_TITLE_SLUG_LENGTH).replace(/_+$/g, '')
}

export function findRowValue(row: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const direct = row[name]
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim()

    const match = Object.keys(row).find(key => key.toLowerCase() === name.toLowerCase())
    if (match) {
      const value = row[match]
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
    }
  }

  return ''
}

export function buildImageFilename({
  id,
  dbId,
  year,
  title,
}: {
  id: string | number
  dbId: string | number
  year: string | number
  title: string
}): string {
  const safeId = safePart(String(id), 'id')
  const safeDbId = safePart(String(dbId), 'dbId')
  const safeYear = safePart(String(year), currentFilenameYear())
  const safeTitle = describeImageFromPrompt(title)
  return `${safeId}_${safeDbId}_${safeYear}_${safeTitle}.png`
}

export function buildFilename(row: DiagramRow, promptOverride?: string): string {
  const prompt = promptOverride ?? ((row.NanoBanana_Prompt || '').trim() || (row.Diagram_Name || '').trim())
  const id = findRowValue(row, ['id']) || (row.SL_NO || '').trim()
  const dbId = findRowValue(row, ['db id', 'dbId', 'db_id', 'dbid', 'DB_ID']) || id
  const year = findRowValue(row, ['year', 'Year'])
  const title = findRowValue(row, [
    'TitleOfImage',
    'titleOfImage',
    'title',
    'Title',
    'Details of Diagram / flowchart / maps needed',
    'Diagram_Name',
  ]) || prompt

  return buildImageFilename({ id, dbId, year, title })
}

export function buildFilepath(row: DiagramRow, promptOverride?: string): string {
  return path.join(FINAL_DIAGRAMS, buildFilename(row, promptOverride))
}

export function imageExists(row: DiagramRow): boolean {
  return fs.existsSync(buildFilepath(row))
}
