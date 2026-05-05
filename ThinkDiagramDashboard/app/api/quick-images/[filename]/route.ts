import { NextRequest } from 'next/server'
import { QUICK_GENERATED } from '@/lib/paths'
import fs from 'fs'
import path from 'path'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params
  const safe     = path.basename(filename)
  const filepath = path.join(QUICK_GENERATED, safe)

  if (!fs.existsSync(filepath)) return new Response(null, { status: 404 })
  const bytes = fs.readFileSync(filepath)
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
}
