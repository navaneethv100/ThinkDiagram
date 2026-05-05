import { NextRequest, NextResponse } from 'next/server'
import { diagramJobs } from '@/lib/jobs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sl_no: string }> },
) {
  const { sl_no } = await params
  return NextResponse.json(diagramJobs.get(sl_no) ?? { status: 'idle' })
}
