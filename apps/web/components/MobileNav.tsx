'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  Bot,
  Shield,
  Settings,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Chats', href: '/conversations', icon: MessageSquare },
  { label: 'Workflows', href: '/workflows', icon: GitBranch },
  { label: 'RAG', href: '/knowledge', icon: BookOpen },
  { label: 'Agentes', href: '/agents', icon: Bot },
  { label: 'Auditoría', href: '/audit', icon: Shield },
  { label: 'Ajustes', href: '/settings', icon: Settings },
];

/** Navegación horizontal para pantallas pequeñas (sidebar oculto). */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden flex gap-1 overflow-x-auto px-4 py-2 border-b border-zinc-800/70 bg-zinc-950/60">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            transitionTypes={['nav-forward']}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 h-8 text-sm whitespace-nowrap transition-colors',
              active
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
