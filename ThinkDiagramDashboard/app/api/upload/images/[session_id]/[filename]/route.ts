import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { imagesDir } from '@/lib/upload-sessions'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ session_id: string; filename: string }> },
) {
  const { session_id, filename } = await params
  const safe     = path.basename(filename)
  const safeId   = path.basename(session_id)
  const filepath = path.join(imagesDir(safeId), safe)

  if (!fs.existsSync(filepath)) return new Response(null, { status: 404 })

  const bytes = fs.readFileSync(filepath)
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  })
}
