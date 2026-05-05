import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { STAGE1_PROMPT, STAGE2_PROMPT } from '@/lib/paths'

export async function GET(req: NextRequest) {
  const stage = req.nextUrl.searchParams.get('stage') ?? '2'
  const file  = stage === '1' ? STAGE1_PROMPT : STAGE2_PROMPT
  return NextResponse.json({ content: fs.readFileSync(file, 'utf-8') })
}

export async function POST(req: NextRequest) {
  const stage   = req.nextUrl.searchParams.get('stage') ?? '2'
  const file    = stage === '1' ? STAGE1_PROMPT : STAGE2_PROMPT
  const { content } = await req.json() as { content?: string }
  fs.writeFileSync(file, content ?? '', 'utf-8')
  return NextResponse.json({ ok: true })
}
