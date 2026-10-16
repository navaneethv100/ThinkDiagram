import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { imagesDir } from '@/lib/upload-sessions'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ session_id: string; filename: string }> },
) {
  const { session_id, filename } = await params
  const safe     = path.basename(filename)
  const safeId   = path.basename(session_id)
  const filepath = path.join(imagesDir(safeId), safe)

  if (!fs.existsSync(filepath)) return new Response(null, { status: 404 })

  const bytes = fs.readFileSync(filepath)
  const isDownload = req.nextUrl.searchParams.get('download') === '1'

  if (isDownload) {
    // Lossless recompression: higher zlib level + optimal filtering only reduce
    // file size; decoded pixels (and thus image quality) are bit-identical.
    const compressed = await sharp(bytes)
      .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true })
      .toBuffer()
    return new Response(compressed, {
      headers: {
        'Content-Type':        'image/png',
        'Content-Disposition': `attachment; filename="${safe}"`,
        'Cache-Control':       'no-store',
      },
    })
  }

  return new Response(bytes, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  })
}
