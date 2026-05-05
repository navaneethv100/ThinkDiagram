import { NextRequest, NextResponse } from 'next/server'
import { runStage1 } from '@/lib/python-bridge'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { description, diagram_type = '' } = await req.json() as {
    description?: string
    diagram_type?: string
  }
  if (!description?.trim())
    return NextResponse.json({ error: 'description is required' }, { status: 400 })

  try {
    const extra  = diagram_type ? `Diagram type: ${diagram_type}` : ''
    const prompt = await runStage1(description.trim(), extra)
    return NextResponse.json({ prompt })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
