'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, Circle } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { useApiStatus } from '@/hooks/useApiStatus';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const SECTION_META: { title: string; subtitle: string } = {
  title: 'Panel',
  subtitle: 'Agent Runtime V2',
};

const SECTION_MAP: { prefix: string; title: string }[] = [
  { prefix: '/conversations', title: 'Conversaciones' },
  { prefix: '/dashboard', title: 'Dashboard' },
  { prefix: '/workflows', title: 'Workflows' },
  { prefix: '/knowledge', title: 'Conocimiento' },
  { prefix: '/agents', title: 'Agentes' },
  { prefix: '/audit', title: 'Auditoría' },
  { prefix: '/settings', title: 'Configuración' },
];

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const status = useApiStatus();
  const isLoginPage = pathname === '/login';

  if (isLoginPage) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-background text-foreground">
        {children}
      </div>
    );
  }

  const section =
    SECTION_MAP.find((s) => pathname.startsWith(s.prefix))?.title ?? SECTION_META.title;

  return (
    <div className="flex w-full min-h-screen bg-background text-foreground">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Topbar — h-16 (solo en desktop lg:flex) */}
        <header className="hidden lg:flex sticky top-0 z-20 h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 backdrop-blur px-4 lg:px-8">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs shrink-0">
              S
            </span>
            <span className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
              Synckre
              <ChevronRight className="size-3.5" />
            </span>
            <span className="text-sm font-semibold text-foreground truncate">{section}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={cn(
                'gap-1.5 text-xs font-mono',
                status === 'online' && 'text-foreground',
                status === 'offline' && 'text-destructive border-destructive/30',
                status === 'checking' && 'text-muted-foreground'
              )}
            >
              <Circle
                className={cn(
                  'size-2 fill-current',
                  status === 'online' && 'text-primary animate-pulse',
                  status === 'offline' && 'text-destructive',
                  status === 'checking' && 'text-muted-foreground animate-pulse'
                )}
              />
              {status === 'online' ? 'API healthy' : status === 'offline' ? 'API offline' : '…'}
            </Badge>
            <UserButton showName={false} appearance={{ elements: { userButtonAvatarBox: 'size-7' } }} />
          </div>
        </header>

        {/* Navegación móvil */}
        <MobileNav />

        <main className="flex-1">
          <div className="max-w-[1280px] mx-auto w-full px-4 lg:px-8 py-6 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
