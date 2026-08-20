'use client';

import React, { useState } from 'react';
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
  Menu,
  X,
  LogOut,
  Activity,
} from 'lucide-react';
import { UserButton, SignOutButton } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useApiStatus } from '@/hooks/useApiStatus';

const ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Conversaciones', href: '/conversations', icon: MessageSquare },
  { label: 'Workflows', href: '/workflows', icon: GitBranch },
  { label: 'RAG / Conocimiento', href: '/knowledge', icon: BookOpen },
  { label: 'Agentes', href: '/agents', icon: Bot },
  { label: 'Auditoría', href: '/audit', icon: Shield },
  { label: 'Configuración', href: '/settings', icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const status = useApiStatus();

  return (
    <>
      {/* Mobile Top Navigation Bar (Hamburguesa + Brand + User) */}
      <div className="lg:hidden flex items-center justify-between px-4 sm:px-6 h-16 border-b border-border bg-background/95 backdrop-blur z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-lg bg-muted/60 text-foreground hover:bg-muted transition"
            aria-label="Abrir menú de navegación"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
              S
            </div>
            <span className="text-sm font-bold text-foreground">Synckre Agent</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 text-[11px] font-mono py-0.5 px-2',
              status === 'online' && 'text-foreground',
              status === 'offline' && 'text-destructive border-destructive/30',
              status === 'checking' && 'text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                status === 'online' && 'bg-primary animate-pulse',
                status === 'offline' && 'bg-destructive',
                status === 'checking' && 'bg-muted animate-pulse'
              )}
            />
            {status === 'online' ? 'API healthy' : status === 'offline' ? 'API offline' : '…'}
          </Badge>
          <UserButton showName={false} appearance={{ elements: { userButtonAvatarBox: 'size-7' } }} />
        </div>
      </div>

      {/* Slide-Over Drawer Overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm animate-fade-slide-in"
          />

          {/* Drawer Content */}
          <div className="relative w-4/5 max-w-xs bg-background h-full border-r border-border p-5 flex flex-col justify-between z-10 shadow-2xl animate-fade-slide-in">
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                    S
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-tight">Synckre Agent</p>
                    <p className="text-[10px] text-muted-foreground uppercase font-mono">Control Center</p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Navigation Links */}
              <nav className="flex flex-col gap-1">
                {ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      transitionTypes={['nav-forward']}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )}
                    >
                      <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Footer with User Profile and API Status */}
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <UserButton showName={false} appearance={{ elements: { userButtonAvatarBox: 'size-7' } }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">Usuario Conectado</p>
                    <p className="text-[10px] text-muted-foreground truncate">Sesión Activa</p>
                  </div>
                </div>
                <SignOutButton>
                  <button className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-950/20">
                    <LogOut className="size-4" />
                  </button>
                </SignOutButton>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span className="flex items-center gap-1.5">
                  <Activity className="size-3.5" />
                  {status === 'online' ? 'API healthy' : 'API offline'}
                </span>
                <Badge variant="outline" className="text-[10px]">v2.2.0</Badge>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
