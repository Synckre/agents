'use client';

import { Badge } from '@/components/ui/badge';
import { Clock, Timer, ChevronDown } from 'lucide-react';
import type { TelemetryLog } from '@/lib/types';

function statusBadge(status: string) {
  switch (status) {
    case 'success':
      return <Badge variant="success" className="text-[10px]">SUCCESS</Badge>;
    case 'requires_human':
    case 'waiting_human':
      return <Badge variant="warning" className="text-[10px]">HUMAN</Badge>;
    case 'temporary_failure':
      return <Badge variant="warning" className="text-[10px]">RETRY</Badge>;
    case 'permanent_failure':
      return <Badge variant="destructive" className="text-[10px]">FAILED</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status.toUpperCase()}</Badge>;
  }
}

function statusTint(status: string) {
  switch (status) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/[0.06] hover:border-emerald-500/60';
    case 'requires_human':
    case 'waiting_human':
      return 'border-amber-500/30 bg-amber-500/[0.06] hover:border-amber-500/60';
    case 'temporary_failure':
      return 'border-amber-500/30 bg-amber-500/[0.06] hover:border-amber-500/60';
    case 'permanent_failure':
      return 'border-rose-500/30 bg-rose-500/[0.06] hover:border-rose-500/60';
    default:
      return 'border-border bg-card hover:border-primary/40';
  }
}

export function TelemetryLogList({ logs }: { logs: TelemetryLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-xs text-zinc-500">
        Esperando eventos técnicos...
        <br />
        <span className="text-zinc-600 mt-1 block">Envía un mensaje que use una tool para ver telemetría.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log, idx) => (
        <details
          key={log.id || idx}
          className={`group p-3 rounded-lg font-mono text-xs space-y-1.5 border bg-card text-foreground transition ${statusTint(log.status)}`}
        >
          <summary className="flex items-center justify-between cursor-pointer list-none">
            <div className="flex items-center gap-1.5 min-w-0">
              <ChevronDown className="size-3 text-muted-foreground group-open:rotate-180 transition-transform shrink-0" />
              <span className="text-foreground font-bold truncate">{log.tool_name}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">{statusBadge(log.status)}</div>
          </summary>

          <div className="pt-2 space-y-1.5 border-t border-border mt-1.5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {new Date(log.created_at).toLocaleTimeString()}
              </span>
              <span className="flex items-center gap-1">
                <Timer className="size-3" />
                {log.execution_time_ms} ms
              </span>
            </div>

            {log.input_data && Object.keys(log.input_data).length > 0 && (
              <div>
                <p className="text-muted-foreground font-semibold mb-1">Params:</p>
                <pre className="bg-muted/40 border border-border rounded p-2 text-xs text-foreground/90 overflow-x-auto max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(log.input_data, null, 2)}
                </pre>
              </div>
            )}

            {log.output_data && (
              <div>
                <p className="text-muted-foreground font-semibold mb-1">Resultado:</p>
                <pre className="bg-muted/40 border border-border rounded p-2 text-xs text-foreground/90 overflow-x-auto max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(log.output_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
