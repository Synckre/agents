'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton, SignOutButton } from '@clerk/nextjs';
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  Bot,
  Shield,
  Settings,
  GitBranch,
  Activity,
  Zap,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useApiStatus } from '@/hooks/useApiStatus';

const NAV_GROUPS: { label: string; items: { label: string; href: string; icon: LucideIcon }[] }[] = [
  {
    label: 'General',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Conversaciones', href: '/conversations', icon: MessageSquare },
    ],
  },
  {
    label: 'Automatización',
    items: [
      { label: 'Workflows', href: '/workflows', icon: GitBranch },
      { label: 'Agentes', href: '/agents', icon: Bot },
    ],
  },
  {
    label: 'Conocimiento',
    items: [{ label: 'RAG', href: '/knowledge', icon: BookOpen }],
  },
  {
    label: 'Sistema',
    items: [
      { label: 'Auditoría', href: '/audit', icon: Shield },
      { label: 'Configuración', href: '/settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const status = useApiStatus();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-background h-screen sticky top-0 z-30">
      {/* Brand — h-16 (mismo alto que la topbar) */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-border">
        <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
          S
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">
            Synckre Agent
          </p>
          <p className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase">
            Control Center
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <p className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    transitionTypes={['nav-forward']}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer status & User Account */}
      <div className="px-4 py-3 border-t border-border space-y-3">
        {/* User Account / Sign Out */}
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border/50">
          <div className="flex items-center gap-2 min-w-0">
            <UserButton showName={false} appearance={{ elements: { userButtonAvatarBox: 'size-7' } }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">Usuario Conectado</p>
              <p className="text-[10px] text-muted-foreground truncate">Sesión Activa</p>
            </div>
          </div>
          <SignOutButton>
            <button
              title="Cerrar Sesión"
              className="p-1.5 rounded-md hover:bg-red-950/30 text-muted-foreground hover:text-red-400 transition"
            >
              <LogOut className="size-4" />
            </button>
          </SignOutButton>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                'size-2 rounded-full',
                status === 'online' && 'bg-primary',
                status === 'offline' && 'bg-destructive',
                status === 'checking' && 'bg-muted animate-pulse'
              )}
            />
            <span className="flex items-center gap-1">
              <Activity className="size-3.5" />
              {status === 'online' ? 'API en línea' : status === 'offline' ? 'API caída' : 'Verificando...'}
            </span>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            v2.2.0
          </Badge>
        </div>
      </div>
    </aside>
  );
}
