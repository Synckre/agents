'use client';

import React, { useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ToolStep {
  tool: string;
  status?: string;
  result?: unknown;
  task_id?: string;
}

function summarize(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const msg = r.message || r.error || r.status;
    if (typeof msg === 'string') return msg;
    return JSON.stringify(result);
  }
  return '';
}

function statusVariant(status?: string): 'success' | 'warning' | 'outline' {
  if (status === 'success') return 'success';
  if (status === 'waiting_human') return 'warning';
  if (status === 'temporary_failure' || status === 'permanent_failure') return 'outline';
  return 'outline';
}

/**
 * Timeline de "pensamiento": muestra las herramientas que el agente está usando
 * (o usó) durante la generación de una respuesta, estilo ChatGPT.
 */
export function ThinkingTimeline({
  steps,
  streaming = false,
  defaultOpen,
}: {
  steps: ToolStep[];
  streaming?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? steps.length > 0);
  // Durante el stream siempre visible: los pasos aparecen en vivo al llegar
  const isOpen = streaming || open;

  const label = streaming
    ? steps.length > 0
      ? 'Ejecutando herramientas'
      : 'Razonando'
    : steps.length > 0
    ? `Usó ${steps.length} herramienta${steps.length > 1 ? 's' : ''}`
    : 'Pensamiento';

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/40"
      >
        <BrainCircuit className={cn('size-4 text-muted-foreground shrink-0', streaming && 'animate-pulse')} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {streaming && (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 ml-auto text-muted-foreground transition-transform shrink-0',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && steps.length > 0 && (
        <ol className="px-3 pb-3 flex flex-col">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'size-2 rounded-full mt-1.5 shrink-0',
                    step.status === 'success' ? 'bg-primary' : step.status === 'waiting_human' ? 'bg-amber-500' : 'bg-muted-foreground'
                  )}
                />
                {i < steps.length - 1 && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className="flex-1 min-w-0 pb-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-xs text-foreground">{step.tool}</code>
                  <Badge variant={statusVariant(step.status)} className="text-[9px]">
                    {step.status || 'ejecutada'}
                  </Badge>
                </div>
                {(() => {
                  const summary = summarize(step.result);
                  return summary ? (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{summary}</p>
                  ) : null;
                })()}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
