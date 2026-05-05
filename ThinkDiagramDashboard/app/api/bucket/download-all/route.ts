import { NextResponse } from 'next/server'
import { readBucket } from '@/lib/bucket'
import { FINAL_DIAGRAMS, QUICK_GENERATED } from '@/lib/paths'
import archiver from 'archiver'
import { Readable } from 'stream'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const items = readBucket()

  const archive = archiver('zip', { zlib: { level: 6 } })

  items.forEach(item => {
    const dir      = item.source === 'quick' ? QUICK_GENERATED : FINAL_DIAGRAMS
    const filepath = path.join(dir, item.filename)
    if (fs.existsSync(filepath)) archive.file(filepath, { name: item.filename })
  })

  archive.finalize()

  const webStream = Readable.toWeb(archive) as ReadableStream
  return new Response(webStream, {
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': 'attachment; filename="bucket_diagrams.zip"',
    },
  })
}
