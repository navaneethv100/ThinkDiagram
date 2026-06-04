import fs from 'fs'
import path from 'path'
import { UPLOADS_DIR } from './paths'

export type RowStatus = 'pending' | 'stage1' | 'stage2' | 'done' | 'error'

export interface UploadRow {
  index: number
  value: string
  status: RowStatus
  prompt: string
  image_file: string
  error: string
  source_id?: string
  db_id?: string
  year?: string
  title?: string
}

export interface UploadSession {
  id: string
  created_at: string
  column: string
  original_filename: string
  rows: UploadRow[]
}

export function sessionDir(id: string): string {
  return path.join(UPLOADS_DIR, id)
}

export function imagesDir(id: string): string {
  return path.join(sessionDir(id), 'images')
}

export function readSession(id: string): UploadSession | null {
  const file = path.join(sessionDir(id), 'data.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as UploadSession
}

export function writeSession(session: UploadSession): void {
  const dir = sessionDir(session.id)
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(session, null, 2), 'utf-8')
}
