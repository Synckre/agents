import React from 'react';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

/**
 * Encabezado de página con chip de ícono neutral (colores del tema).
 */
export function PageHeader({ icon: Icon, title, description, right, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4', className)}>
      <div className="flex items-start sm:items-center gap-3">
        <span className="chip-icon mt-0.5 sm:mt-0 shrink-0">
          <Icon className="size-5 sm:size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2.5 flex-wrap">
            {title}
          </h2>
          {description && <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">{right}</div>}
    </div>
  );
}
