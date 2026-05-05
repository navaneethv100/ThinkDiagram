import { NextRequest, NextResponse } from 'next/server'
import { quickJobs } from '@/lib/jobs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await params
  return NextResponse.json(quickJobs.get(job_id) ?? { status: 'not_found' })
}
