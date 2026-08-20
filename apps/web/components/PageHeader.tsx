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
    <div className={cn('flex items-center justify-between border-b border-border pb-4', className)}>
      <div className="flex items-center gap-3">
        <span className="chip-icon">
          <Icon />
        </span>
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2.5">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}
