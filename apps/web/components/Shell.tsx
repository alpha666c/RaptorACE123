'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/chat', label: 'Chat' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/memory', label: 'Memory' },
  { href: '/skills', label: 'Skills' },
  { href: '/mcp', label: 'MCP' },
  { href: '/settings', label: 'Settings' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 border-r border-white/10 p-4 flex flex-col gap-1">
        <div className="font-semibold tracking-tight mb-4 text-sm text-white/80">Personal Agent</div>
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded text-sm ${
                active ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
