import { NextRequest, NextResponse } from 'next/server'
import { readBucket, writeBucket } from '@/lib/bucket'
import { v4 as uuidv4 } from 'uuid'
import type { BucketItem } from '@/lib/types'

export async function POST(req: NextRequest) {
  const data = await req.json() as Partial<BucketItem>
  const item: BucketItem = {
    id:          uuidv4(),
    filename:    data.filename    ?? '',
    source:      data.source      ?? 'quick',
    label:       data.label       ?? '',
    description: data.description ?? '',
    added_at:    new Date().toISOString().slice(0, 19),
  }
  const items = readBucket()
  items.push(item)
  await writeBucket(items)
  return NextResponse.json({ ok: true, id: item.id, count: items.length })
}
