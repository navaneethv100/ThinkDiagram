import { NextRequest, NextResponse } from 'next/server'
import { readBucket, writeBucket } from '@/lib/bucket'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const items = readBucket().filter(i => i.id !== id)
  await writeBucket(items)
  return NextResponse.json({ ok: true, count: items.length })
}
