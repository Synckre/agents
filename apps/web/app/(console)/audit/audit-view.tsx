'use client';

import React from 'react';
import { Shield, Clock, Wrench, Bot, Activity, ChevronDown, Filter } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import { cn } from '@/lib/utils';
import { useAuditLogs, type AuditResultFilter } from '@/hooks/useAuditLogs';
import type { AuditLog } from '@/lib/types';

function resultMeta(result: string) {
  switch (result) {
    case 'authorized':
      return { label: 'Autorizado', variant: 'success' as const };
    case 'approval_requested':
      return { label: 'Requiere aprobación', variant: 'warning' as const };
    case 'denied':
      return { label: 'Denegado', variant: 'destructive' as const };
    default:
      return { label: result, variant: 'outline' as const };
  }
}

function actionIcon(action: string, toolName?: string | null) {
  if (action === 'tool_execution' || toolName) return Wrench;
  if (action === 'agent_execution') return Bot;
  return Activity;
}

export function AuditView({ initialLogs }: { initialLogs: AuditLog[] }) {
  const { logs, loading, filter, setFilter, expanded, filtered, counts, toggle } = useAuditLogs(initialLogs);

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Shield}
          title="Registro de auditoría"
          description="Historial de ejecuciones de herramientas y decisiones del runtime."
          right={
            logs.length > 0 ? (
              <Badge variant="secondary" className="font-mono">
                {logs.length} eventos
              </Badge>
            ) : undefined
          }
        />

        {/* Resumen */}
        {!loading && logs.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{counts.total} total</Badge>
            <Badge variant="success">{counts.authorized} autorizados</Badge>
            <Badge variant="warning">{counts.approval} con aprobación</Badge>
            <Badge variant="destructive">{counts.denied} denegados</Badge>
          </div>
        )}

        <Card>
          <CardHeader className="border-b border-border pb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                <CardTitle>Eventos</CardTitle>
              </div>
              {/* Filtro por resultado */}
              <div className="flex items-center gap-2">
                <Filter className="size-4 text-muted-foreground" />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as AuditResultFilter)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="all">Todos</option>
                  <option value="authorized">Autorizados</option>
                  <option value="approval_requested">Requieren aprobación</option>
                  <option value="denied">Denegados</option>
                </select>
              </div>
            </div>
            <CardDescription>
              Solo metadatos técnicos (rol, tool, resultado). El texto de conversación no se audita.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="p-5 flex flex-col gap-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {logs.length === 0
                  ? 'Sin eventos de auditoría registrados.'
                  : 'No hay eventos con ese filtro.'}
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {filtered.map((log) => {
                  const meta = resultMeta(log.authorization_result);
                  const Icon = actionIcon(log.action, log.tool_name);
                  const isOpen = expanded.has(log.id);
                  const hasDetail = log.input_summary || log.output_summary;
                  return (
                    <li key={log.id} className="p-4 lg:px-5">
                      <button
                        onClick={() => hasDetail && toggle(log.id)}
                        className={cn(
                          'w-full text-left flex items-start gap-3',
                          hasDetail && 'cursor-pointer'
                        )}
                      >
                        <div className="size-9 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center shrink-0">
                          <Icon className="size-4" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">
                              {log.tool_name || (log.action === 'agent_execution' ? 'Ejecución del agente' : log.action)}
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="size-3" />
                                {new Date(log.timestamp).toLocaleString('es')}
                              </span>
                              {hasDetail && (
                                <ChevronDown
                                  className={cn(
                                    'size-4 text-muted-foreground transition-transform',
                                    isOpen && 'rotate-180'
                                  )}
                                />
                              )}
                            </div>
                          </div>

                          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                            <Badge variant={meta.variant} className="text-[10px]">
                              {meta.label}
                            </Badge>
                            <span>Rol: {log.agent_role.replace(/_/g, ' ')}</span>
                            {log.user_id && <span>· Usuario: {log.user_id}</span>}
                            {log.action === 'tool_execution' && (
                              <span className="font-mono text-xs">· {log.tool_name}</span>
                            )}
                          </div>

                          {isOpen && (
                            <div className="mt-3 flex flex-col gap-2">
                              {log.input_summary && (
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">Entrada</p>
                                  <p className="text-sm text-foreground bg-muted/40 border border-border rounded-lg p-3 break-words">
                                    {log.input_summary}
                                  </p>
                                </div>
                              )}
                              {log.output_summary && (
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">Salida</p>
                                  <p className="text-sm text-foreground bg-muted/40 border border-border rounded-lg p-3 break-words">
                                    {log.output_summary}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}
