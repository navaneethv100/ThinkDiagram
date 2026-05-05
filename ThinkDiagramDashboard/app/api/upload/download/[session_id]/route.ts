import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import archiver from 'archiver'
import { Readable } from 'stream'
import { imagesDir, readSession } from '@/lib/upload-sessions'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await params
  const safeId = path.basename(session_id)

  const session = readSession(safeId)
  if (!session) return new Response('Session not found', { status: 404 })

  const { filenames } = await req.json() as { filenames: string[] }
  if (!filenames?.length) return new Response('No files provided', { status: 400 })

  const dir     = imagesDir(safeId)
  const archive = archiver('zip', { zlib: { level: 6 } })

  filenames.forEach(filename => {
    const safe = path.basename(filename)
    const fp   = path.join(dir, safe)
    if (fs.existsSync(fp)) archive.file(fp, { name: safe })
  })

  archive.finalize()

  const webStream = Readable.toWeb(archive) as ReadableStream
  return new Response(webStream, {
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="diagrams_${safeId.slice(0, 8)}.zip"`,
    },
  })
}
