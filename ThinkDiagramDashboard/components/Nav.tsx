'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all
        ${active ? 'text-white bg-white/[.12]' : 'text-slate-400 hover:text-white hover:bg-white/[.08]'}`}
    >
      {children}
    </Link>
  )
}

export default function Nav() {
  const pathname = usePathname()
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/bucket/count').then(r => r.json()).then((d: { count: number }) => setCount(d.count))
  }, [])

  return (
    <nav className="bg-[#0f172a] h-[52px] px-6 flex items-center gap-2 sticky top-0 z-[300]"
         style={{ boxShadow: '0 2px 12px rgba(0,0,0,.35)' }}>
      <Link href="/" className="text-white font-black text-sm mr-auto tracking-tight no-underline">
        ⚡ UPSC Diagrams
      </Link>
      <NavLink href="/" active={pathname === '/' || pathname === '/generate'}>Quick Generate</NavLink>
      <NavLink href="/upload" active={pathname.startsWith('/upload')}>Upload & Generate</NavLink>
      <NavLink href="/bucket" active={pathname === '/bucket'}>
        Bucket{' '}
        <span className={`rounded-full px-1.5 py-0 text-[.68rem] font-bold min-w-[20px] text-center
          ${count === 0 ? 'bg-white/[.12] text-slate-400' : 'bg-violet-700 text-white'}`}>
          {count}
        </span>
      </NavLink>
    </nav>
  )
}
