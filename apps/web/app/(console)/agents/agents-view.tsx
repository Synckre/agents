'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  ShieldCheck,
  Sparkles,
  Activity,
  Clock,
  Wrench,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  Cpu,
  Zap,
  BarChart3,
  Layers,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectBackdrop,
  SelectPositioner,
  SelectPopup,
  SelectList,
  SelectItem,
  SelectItemText,
} from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import { cn } from '@/lib/utils';
import { useAgentTelemetry } from '@/hooks/useAgentTelemetry';
import type { AgentRole, TelemetryLog } from '@/lib/types';

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSeconds < 60) return `Hace ${Math.max(1, diffSeconds)}s`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `Hace ${diffMinutes}m`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Hace ${diffHours}h`;
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

export function AgentsView({
  initialStats,
  initialToolExecutions,
  initialRoles,
}: {
  initialStats: Record<string, number>;
  initialToolExecutions: TelemetryLog[];
  initialRoles?: AgentRole[];
}) {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'roles'>('telemetry');

  const {
    executions,
    filteredExecutions,
    roles,
    loading,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    expandedId,
    toggleExpand,
    metrics,
    refresh,
  } = useAgentTelemetry({ initialStats, initialToolExecutions, initialRoles });

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Bot}
          title="Telemetría y Estado de Agentes"
          description="Supervisión en tiempo real de ejecuciones, latencias, estado de flujos y permisos de cada rol."
          right={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={loading}
                className="gap-1.5"
              >
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
                <span>Refrescar</span>
              </Button>
            </div>
          }
        />

        {/* Pestañas / Tabs Header */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('telemetry')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px',
              activeTab === 'telemetry'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Activity className="size-4" />
            Telemetría en Vivo
            {executions.length > 0 && (
              <Badge variant="secondary" className="font-mono text-[11px] ml-1">
                {executions.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px',
              activeTab === 'roles'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Bot className="size-4" />
            Roles y Matriz de Permisos
            <Badge variant="outline" className="font-mono text-[11px] ml-1">
              {roles.length}
            </Badge>
          </button>
        </div>

        {activeTab === 'telemetry' ? (
          <div className="space-y-6">
            {/* KPI Cards de Telemetría */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide">Ejecuciones 24h</span>
                  <Activity className="size-4 text-primary" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono">{metrics.runs24h}</span>
                  <span className="text-xs text-muted-foreground font-mono">/ {metrics.totalRuns} total</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Corridas del Agent Runtime</p>
              </Card>

              <Card className="p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide">Tasa de Éxito (Herramientas)</span>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-emerald-500">{metrics.successRate}%</span>
                  <span className="text-xs text-muted-foreground font-mono">({metrics.failedExecs} fallos)</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Total invocaciones: {metrics.totalExecs}</p>
              </Card>

              <Card className="p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide">Latencia Promedio</span>
                  <Clock className="size-4 text-amber-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono">{metrics.avgToolTime} ms</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Tiempo de respuesta de herramientas</p>
              </Card>

              <Card className="p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide">Modelos & Recursos</span>
                  <Cpu className="size-4 text-blue-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono">{metrics.llmCalls}</span>
                  <span className="text-xs text-muted-foreground">llamadas LLM</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  {metrics.totalTokens.toLocaleString()} tokens procesados
                </p>
              </Card>
            </div>

            {/* Estado de Salud por Agente (Flujos Activos) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  Salud de Flujos por Rol de Agente
                </CardTitle>
                <CardDescription>
                  Evaluación de estado en tiempo real para cada agente autónomo de Synckre.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                {roles.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No se han cargado roles aún. Verifica la conexión con la API del backend.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {roles.map((role) => {
                      const allowedTools = role.allowed_tools || [];
                      const roleExecs = executions.filter((e) => allowedTools.includes(e.tool_name));
                      const hasErrors = roleExecs.some((e) => e.status !== 'success' && e.status !== 'authorized');
                      const isActive = roleExecs.length > 0;

                      return (
                        <div
                          key={role.name}
                          className="p-4 rounded-xl border border-border bg-muted/30 flex flex-col justify-between gap-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-mono text-sm font-semibold text-foreground">{role.name}</span>
                              {role.title && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{role.title}</p>}
                            </div>
                            <Badge
                              variant={hasErrors ? 'destructive' : isActive ? 'success' : 'secondary'}
                              className="text-[10px] shrink-0 gap-1"
                            >
                              <span
                                className={cn(
                                  'size-1.5 rounded-full',
                                  hasErrors ? 'bg-destructive' : isActive ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
                                )}
                              />
                              {hasErrors ? 'Con alertas' : isActive ? 'Activo' : 'En espera'}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                            <span>{allowedTools.length} Herramientas</span>
                            <span className="font-mono">{roleExecs.length} ejecuciones</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Consola de Telemetría Detallada */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="size-4 text-primary" />
                      Detalle de Ejecuciones de Herramientas (Qué, Cómo y Cuándo)
                    </CardTitle>
                    <CardDescription>
                      Inspección detallada de parámetros de entrada, salidas y latencias del Agent Runtime.
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    {filteredExecutions.length} registros
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                {/* Filtros */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Buscar por herramienta, ID de conversación o tarea..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-8"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-md transition"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="w-full sm:w-48">
                    <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val || 'all')}>
                      <SelectTrigger>
                        <SelectValue placeholder="Estado" />
                      </SelectTrigger>
                      <SelectPortal>
                        <SelectBackdrop />
                        <SelectPositioner>
                          <SelectPopup>
                            <SelectList>
                              <SelectItem value="all">
                                <SelectItemText>Todos los estados</SelectItemText>
                              </SelectItem>
                              <SelectItem value="success">
                                <SelectItemText>Solo exitosos</SelectItemText>
                              </SelectItem>
                              <SelectItem value="failure">
                                <SelectItemText>Solo fallos / errores</SelectItemText>
                              </SelectItem>
                            </SelectList>
                          </SelectPopup>
                        </SelectPositioner>
                      </SelectPortal>
                    </Select>
                  </div>
                </div>

                {/* Lista de Registros de Telemetría */}
                {loading && executions.length === 0 ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                  </div>
                ) : filteredExecutions.length === 0 ? (
                  <div className="text-center p-8 border border-dashed rounded-xl bg-muted/20">
                    <p className="text-sm text-muted-foreground">
                      No hay registros de telemetría que coincidan con la búsqueda.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredExecutions.map((exec, idx) => {
                      const idKey = exec.id || `exec-${idx}`;
                      const isExpanded = expandedId === idKey;
                      const isSuccess = exec.status === 'success' || exec.status === 'authorized';

                      return (
                        <div
                          key={idKey}
                          className="border border-border rounded-xl bg-card transition hover:border-primary/30 overflow-hidden"
                        >
                          <div
                            onClick={() => toggleExpand(idKey)}
                            className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className={cn(
                                  'size-8 rounded-lg flex items-center justify-center shrink-0 font-mono text-xs font-semibold',
                                  isSuccess
                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                                )}
                              >
                                {isSuccess ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                              </span>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <code className="font-mono text-sm font-semibold text-foreground bg-muted border border-border rounded px-2 py-0.5">
                                    {exec.tool_name}
                                  </code>
                                  <Badge variant={isSuccess ? 'success' : 'destructive'} className="text-[10px]">
                                    {exec.status}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                  <span>{formatTimeAgo(exec.created_at)}</span>
                                  {exec.conversation_id && (
                                    <Link
                                      href={`/conversations/${exec.conversation_id}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="font-mono text-primary hover:underline flex items-center gap-1"
                                    >
                                      Conv: {exec.conversation_id.slice(0, 8)}...
                                      <ArrowUpRight className="size-3" />
                                    </Link>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                              <span className="font-mono text-xs text-muted-foreground bg-muted/60 px-2 py-1 rounded border border-border">
                                ⏱️ {exec.execution_time_ms} ms
                              </span>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                              </Button>
                            </div>
                          </div>

                          {/* Detalle Acordeón (Input & Output Data) */}
                          {isExpanded && (
                            <div className="p-4 border-t border-border bg-muted/40 text-xs space-y-3">
                              <div>
                                <p className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                  <Layers className="size-3.5" />
                                  Parámetros de Entrada (Input Data)
                                </p>
                                <pre className="p-3 bg-zinc-950 text-zinc-200 font-mono text-[11px] rounded-lg overflow-x-auto border border-zinc-800">
                                  {JSON.stringify(exec.input_data || {}, null, 2)}
                                </pre>
                              </div>

                              {exec.output_data && (
                                <div>
                                  <p className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <BarChart3 className="size-3.5" />
                                    Resultado / Respuesta de la Herramienta (Output Data)
                                  </p>
                                  <pre className="p-3 bg-zinc-950 text-zinc-200 font-mono text-[11px] rounded-lg overflow-x-auto border border-zinc-800">
                                    {JSON.stringify(exec.output_data, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Pestaña 2: Definición de Roles y Permisos */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {roles.map((role) => {
              const allowedTools = role.allowed_tools || [];
              const autonomyLabel =
                role.autonomy_label ||
                `Level ${role.autonomy_level || 2} — ${(role.autonomy_level || 2) >= 3 ? 'SENSITIVE ACTION' : 'SAFE ACTION'}`;

              return (
                <Card key={role.name}>
                  <CardHeader className="border-b border-border pb-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="chip-icon shrink-0">
                          <Bot />
                        </span>
                        <div>
                          <CardTitle className="text-base sm:text-lg truncate">{role.name}</CardTitle>
                          {role.title && <p className="text-xs text-muted-foreground">{role.title}</p>}
                        </div>
                      </div>
                      <Badge
                        variant={autonomyLabel.includes('3') ? 'warning' : 'success'}
                        className="shrink-0 text-[11px]"
                      >
                        <ShieldCheck className="mr-1 size-3.5" />
                        {autonomyLabel}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-5 flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground">{role.description}</p>

                    <Separator />

                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Herramientas autorizadas ({allowedTools.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {allowedTools.map((tool) => (
                          <code
                            key={tool}
                            className="font-mono text-xs text-foreground bg-muted border border-border rounded-md px-2 py-1"
                          >
                            {tool}
                          </code>
                        ))}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Sparkles className="size-3.5" />
                      Autonomía {autonomyLabel.split(' — ')[0]}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
