'use client'
import { useEffect, useState } from 'react'
import { showToast } from '@/components/Toast'

export default function SystemPromptsPanel() {
  const [open,   setOpen]   = useState(false)
  const [active, setActive] = useState<'1' | '2'>('1')
  const [sp1,    setSp1]    = useState('')
  const [sp2,    setSp2]    = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/system-prompt?stage=1').then(r => r.json()),
      fetch('/api/system-prompt?stage=2').then(r => r.json()),
    ]).then(([d1, d2]: [{ content: string }, { content: string }]) => {
      setSp1(d1.content); setSp2(d2.content)
    })
  }, [])

  async function save(stage: '1' | '2') {
    const content = stage === '1' ? sp1 : sp2
    const res = await fetch(`/api/system-prompt?stage=${stage}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    showToast(res.ok ? `Stage ${stage} prompt saved` : 'Save failed', !res.ok)
  }

  return (
    <div className="bg-[#1e293b] border-b border-slate-700">
      <button onClick={() => setOpen(o => !o)}
              className="w-full px-6 py-2.5 bg-transparent border-none text-slate-400 text-xs
                         font-medium cursor-pointer text-left flex items-center gap-2 hover:text-slate-200">
        <span className={`text-[.6rem] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        System Prompts — Stage 1 &amp; Stage 2 (click to edit)
      </button>

      {open && (
        <div className="px-6 pb-4 flex flex-col gap-3">
          <div className="flex gap-1">
            {(['1', '2'] as const).map(s => (
              <button key={s} onClick={() => setActive(s)}
                      className={`px-3.5 py-1.5 rounded text-xs font-semibold border transition-all cursor-pointer
                        ${active === s
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-transparent text-slate-400 border-slate-600 hover:text-slate-200'}`}>
                {s === '1' ? 'Stage 1 — Gemini Prompt Generator' : 'Stage 2 — Nano Banana System Prompt'}
              </button>
            ))}
          </div>

          {active === '1' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-400">stage1_gemini_prompt_generator.txt</label>
              <textarea value={sp1} onChange={e => setSp1(e.target.value)}
                        className="w-full h-40 bg-[#0f172a] text-slate-200 border border-slate-600
                                   rounded-md p-3 font-mono text-xs leading-relaxed resize-y
                                   focus:outline-none focus:border-blue-500" />
              <button onClick={() => save('1')}
                      className="self-start px-4 py-1.5 bg-blue-500 text-white border-none
                                 rounded text-xs font-semibold cursor-pointer hover:bg-blue-600">
                Save Stage 1 Prompt
              </button>
            </div>
          )}
          {active === '2' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-400">stage2_nanoBanana_image_generator.txt</label>
              <textarea value={sp2} onChange={e => setSp2(e.target.value)}
                        className="w-full h-40 bg-[#0f172a] text-slate-200 border border-slate-600
                                   rounded-md p-3 font-mono text-xs leading-relaxed resize-y
                                   focus:outline-none focus:border-blue-500" />
              <button onClick={() => save('2')}
                      className="self-start px-4 py-1.5 bg-blue-500 text-white border-none
                                 rounded text-xs font-semibold cursor-pointer hover:bg-blue-600">
                Save Stage 2 Prompt
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
