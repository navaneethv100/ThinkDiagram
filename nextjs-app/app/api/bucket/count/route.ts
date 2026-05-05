import { NextResponse } from 'next/server'
import { readBucket } from '@/lib/bucket'

export async function GET() {
  return NextResponse.json({ count: readBucket().length })
}
