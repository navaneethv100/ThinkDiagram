'use client'
import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ParseResult {
  columns: string[]
  preview: Record<string, string>[]
  total: number
  filename: string
  rows: Record<string, string>[]
}

export default function UploadPage() {
  const router = useRouter()

  const [step,      setStep]      = useState<'drop' | 'column' | 'starting'>('drop')
  const [dragging,  setDragging]  = useState(false)
  const [parsed,    setParsed]    = useState<ParseResult | null>(null)
  const [column,    setColumn]    = useState<string>('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const parseFile = useCallback(async (file: File) => {
    setError('')
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload/parse', { method: 'POST', body: fd })
      const data = await res.json() as ParseResult & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Parse failed')
      setParsed(data)
      setColumn('')
      setStep('column')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }, [parseFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }, [parseFile])

  async function handleGenerate() {
    if (!parsed || !column) return
    setStep('starting')
    setError('')
    try {
      const res  = await fetch('/api/upload/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column, filename: parsed.filename, rows: parsed.rows }),
      })
      const data = await res.json() as { session_id?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to start')
      router.push(`/upload/${data.session_id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('column')
    }
  }

  const preview = parsed && column
    ? parsed.preview.map(r => r[column]).filter(Boolean)
    : []

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Upload & Generate</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload a CSV or Excel file, pick the column that has your topics, and let the AI generate a diagram for each one.
          </p>
        </div>

        {/* Step 1 — Drop zone */}
        {(step === 'drop' || step === 'column') && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => step === 'drop' && inputRef.current?.click()}
            className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer mb-6
              ${step !== 'drop' ? 'cursor-default border-slate-200 bg-white' : ''}
              ${step === 'drop' && !dragging ? 'border-slate-300 bg-white hover:border-violet-400 hover:bg-violet-50/40' : ''}
              ${dragging ? 'border-violet-500 bg-violet-50' : ''}`}
          >
            <div className="flex flex-col items-center justify-center gap-3 py-12 px-8 text-center">
              {loading ? (
                <>
                  <div className="w-10 h-10 rounded-full border-[3px] border-slate-200 border-t-violet-600"
                       style={{ animation: 'spin .75s linear infinite' }} />
                  <span className="text-sm text-slate-500">Parsing file…</span>
                </>
              ) : parsed ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{parsed.filename}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{parsed.total} rows · {parsed.columns.length} columns</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setStep('drop'); setParsed(null); setColumn('') }}
                    className="text-xs text-slate-400 hover:text-red-500 underline bg-transparent border-none cursor-pointer"
                  >
                    Upload a different file
                  </button>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                    <svg className="w-7 h-7 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 7l-4-4-4 4M12 3v13" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Drop your file here</p>
                    <p className="text-xs text-slate-400 mt-0.5">or click to browse · CSV, XLSX, XLS</p>
                  </div>
                </>
              )}
            </div>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} />
          </div>
        )}

        {/* Step 2 — Column picker */}
        {step === 'column' && parsed && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-3">
              Which column contains the topics / questions to generate diagrams for?
            </p>
            <div className="flex flex-wrap gap-2 mb-5">
              {parsed.columns.map(col => (
                <button
                  key={col}
                  onClick={() => setColumn(col)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                    ${column === col
                      ? 'bg-violet-700 text-white border-violet-700'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-violet-400 hover:text-violet-700'}`}
                >
                  {col}
                </button>
              ))}
            </div>

            {/* Preview */}
            {column && preview.length > 0 && (
              <div className="mb-5">
                <p className="text-[.7rem] font-bold text-slate-400 uppercase tracking-wide mb-2">
                  Preview — first {preview.length} values from &ldquo;{column}&rdquo;
                </p>
                <ul className="space-y-1">
                  {preview.map((v, i) => (
                    <li key={i} className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5 line-clamp-2">
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={!column}
              className="w-full py-2.5 bg-violet-700 text-white rounded-xl text-sm font-bold
                         hover:bg-violet-800 disabled:bg-violet-300 disabled:cursor-not-allowed
                         transition-colors"
            >
              Generate {parsed.total} Diagram{parsed.total !== 1 ? 's' : ''} →
            </button>
          </div>
        )}

        {/* Starting state */}
        {step === 'starting' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-[3px] border-slate-200 border-t-violet-600"
                 style={{ animation: 'spin .75s linear infinite' }} />
            <p className="text-sm text-slate-500">Starting generation…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </div>
        )}
      </div>
    </main>
  )
}
