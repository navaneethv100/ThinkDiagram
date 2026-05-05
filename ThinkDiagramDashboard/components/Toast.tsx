'use client'
import { useEffect, useRef, useState } from 'react'

let _showToast: (msg: string, err?: boolean) => void = () => {}
export function showToast(msg: string, err = false) { _showToast(msg, err) }

export default function Toast() {
  const [state, setState] = useState<{ msg: string; err: boolean; visible: boolean }>({
    msg: '', err: false, visible: false,
  })
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    _showToast = (msg, err = false) => {
      setState({ msg, err, visible: true })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setState(s => ({ ...s, visible: false })), 3000)
    }
  }, [])

  return (
    <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-[.82rem] font-medium
      text-slate-50 z-[9999] pointer-events-none max-w-[340px] transition-all duration-200
      ${state.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      ${state.err ? 'bg-red-600' : 'bg-[#0f172a]'}`}>
      {state.msg}
    </div>
  )
}
