'use client'
import { useEffect, useMemo, useState } from 'react'
import DiagramCard from './DiagramCard'
import SystemPromptsPanel from './SystemPromptsPanel'
import type { DiagramCard as DiagramCardType } from '@/lib/types'

type Tab = 'all' | 'done' | 'missing'

export default function DashboardClient() {
  const [diagrams,   setDiagrams]   = useState<DiagramCardType[]>([])
  const [loading,    setLoading]    = useState(true)
  const [activeTab,  setActiveTab]  = useState<Tab>('all')
  const [search,     setSearch]     = useState('')

  useEffect(() => {
    fetch('/api/diagrams')
      .then(r => r.json())
      .then((data: DiagramCardType[]) => { setDiagrams(data); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return diagrams.filter(d => {
      const tabOk = activeTab === 'all'
        ? true : activeTab === 'done'
        ? !!d.image_file : !d.image_file
      const searchOk = !q || d.sl_no.includes(q) || d.question.toLowerCase().includes(q)
        || d.diagram_name.toLowerCase().includes(q)
      return tabOk && searchOk
    })
  }, [diagrams, activeTab, search])

  const total   = diagrams.length
  const done    = diagrams.filter(d => d.image_file).length
  const missing = total - done

  return (
    <>
      <SystemPromptsPanel />

      {/* Filter bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-2.5 flex-wrap">
        <div className="flex gap-1">
          {([['all', `All (${total})`], ['done', `Generated (${done})`], ['missing', `Missing (${missing})`]] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-3.5 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-all
                      ${activeTab === tab
                        ? 'bg-[#0f172a] text-white border-[#0f172a]'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search SL# or keyword…"
          className="flex-1 min-w-[180px] max-w-[300px] px-3 py-1.5 border border-slate-200 rounded-md
                     text-xs focus:outline-none focus:border-blue-500" />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">No diagrams match your filter.</div>
      ) : (
        <div className="p-5 max-w-[1700px] mx-auto"
             style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(370px, 1fr))', gap: '18px' }}>
          {filtered.map(d => <DiagramCard key={d.sl_no} d={d} />)}
        </div>
      )}
    </>
  )
}
