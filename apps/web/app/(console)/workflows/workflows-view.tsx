'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import {
  GitBranch,
  RefreshCw,
  Clock,
  UserCheck,
  Headset,
  MessageSquare,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Hash,
  CalendarDays,
  CircleDot,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflows } from '@/hooks/useWorkflows';
import type { BackgroundJob, WorkflowTask } from '@/lib/types';

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' }> = {
  waiting_human: { label: 'En espera de humano', variant: 'warning' },
  completed: { label: 'Completada', variant: 'success' },
  done: { label: 'Completado', variant: 'success' },
  failed: { label: 'Fallida', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
  pending: { label: 'Pendiente', variant: 'outline' },
  running: { label: 'En curso', variant: 'info' },
};

function statusLabel(status: string) {
  return STATUS_META[status] || { label: status, variant: 'outline' as const };
}

const ACTION_COPY = {
  escalation: {
    approve: {
      title: 'Marcar escalación como atendida',
      description:
        'El cliente fue atendido por un operador. La conversación volverá a ser gestionada por el agente.',
      confirm: 'Marcar como atendida',
    },
    reject: {
      title: 'Descartar escalación',
      description:
        'La escalación se cerrará sin ser atendida y la conversación volverá al agente. Esta acción no se puede deshacer.',
      confirm: 'Descartar escalación',
    },
  },
  hitl: {
    approve: {
      title: 'Aprobar y ejecutar',
      description: 'La herramienta se ejecutará con los parámetros indicados anteriormente.',
      confirm: 'Aprobar y ejecutar',
    },
    reject: {
      title: 'Rechazar tarea',
      description: 'La tarea se cancelará y la herramienta sensible no se ejecutará.',
      confirm: 'Rechazar tarea',
    },
  },
} as const;

export function WorkflowsView({
  initialTasks,
  initialJobs,
}: {
  initialTasks: WorkflowTask[];
  initialJobs?: BackgroundJob[];
}) {
  const [activeTab, setActiveTab] = React.useState<'tasks' | 'jobs'>('tasks');
  const [expandedJobId, setExpandedJobId] = React.useState<string | null>(null);

  const {
    tasks,
    jobs,
    selectedTask,
    loading,
    approvalReason,
    setApprovalReason,
    editedParams,
    setEditedParams,
    actionLoading,
    showJson,
    setShowJson,
    pendingAction,
    setPendingAction,
    refresh,
    selectTask,
    decideHitl,
    closePendingAction,
    isEscalation,
    waitingHuman,
    stepState,
  } = useWorkflows({ initialTasks, initialJobs });

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={GitBranch}
          title="Workflows, Jobs y Schedulers"
          description="Seguimiento en tiempo real de tareas, trabajos en segundo plano, correos y cronjobs del sistema."
          right={
            <Button
              variant="outline"
              size="icon"
              onClick={refresh}
              disabled={loading}
              title="Refrescar datos"
              aria-label="Refrescar datos"
              className="size-9 rounded-lg border-border"
            >
              <RefreshCw className={cn("size-4", loading && 'animate-spin')} />
            </Button>
          }
        />

        {/* Header de Pestañas */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('tasks')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px',
              activeTab === 'tasks'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <GitBranch className="size-4" />
            Tareas y Aprobaciones HITL
            {tasks.length > 0 && (
              <Badge variant="secondary" className="font-mono text-[11px] ml-1">
                {tasks.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('jobs')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px',
              activeTab === 'jobs'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Clock className="size-4" />
            Trabajos en Segundo Plano y Cronjobs (Jobs & Schedulers)
            {jobs.length > 0 && (
              <Badge variant="outline" className="font-mono text-[11px] ml-1">
                {jobs.length}
              </Badge>
            )}
          </button>
        </div>

        {activeTab === 'jobs' ? (
          <div className="space-y-6">
            {/* Estado de Schedulers y Workers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4 flex items-center gap-3">
                <span className="size-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Motor de Jobs (Postgres)</p>
                  <p className="text-sm font-bold text-foreground">Activo (`SKIP LOCKED`)</p>
                </div>
              </Card>

              <Card className="p-4 flex items-center gap-3">
                <span className="size-9 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
                  <Clock className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Cronjob Recordatorios</p>
                  <p className="text-sm font-bold text-foreground">Activo (Cada 60s)</p>
                </div>
              </Card>

              <Card className="p-4 flex items-center gap-3">
                <span className="size-9 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-500 flex items-center justify-center shrink-0">
                  <CalendarDays className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Jobs en Cola</p>
                  <p className="text-sm font-bold text-foreground font-mono">{jobs.length} registrados</p>
                </div>
              </Card>
            </div>

            {/* Tabla / Lista de Jobs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="size-4 text-primary" />
                  Cola de Trabajos y Envíos Programados (Postgres Jobs)
                </CardTitle>
                <CardDescription>
                  Registro de ejecuciones diferidas (mails de seguimiento, recordatorios de citas y cronjobs).
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                {loading && jobs.length === 0 ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="text-center p-8 border border-dashed rounded-xl bg-muted/20">
                    <p className="text-sm text-muted-foreground">
                      No hay trabajos diferidos o cronjobs programados en este momento.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => {
                      const isExpanded = expandedJobId === job.id;
                      const st = statusLabel(job.status);
                      const isDone = job.status === 'done' || job.status === 'completed';

                      return (
                        <div
                          key={job.id}
                          className="border border-border rounded-xl bg-card transition hover:border-primary/30 overflow-hidden"
                        >
                          <div
                            onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className={cn(
                                  'size-9 rounded-lg flex items-center justify-center shrink-0 font-mono text-xs font-semibold',
                                  isDone
                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    : job.status === 'failed'
                                    ? 'bg-destructive/10 text-destructive border border-destructive/20'
                                    : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                )}
                              >
                                {isDone ? (
                                  <CheckCircle2 className="size-4" />
                                ) : job.status === 'failed' ? (
                                  <XCircle className="size-4" />
                                ) : (
                                  <Clock className="size-4" />
                                )}
                              </span>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <code className="font-mono text-sm font-semibold text-foreground bg-muted border border-border rounded px-2 py-0.5">
                                    {job.kind}
                                  </code>
                                  <Badge variant={st.variant} className="text-[10px]">
                                    {st.label}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                                  <span>ID: {job.id.slice(0, 8)}...</span>
                                  {job.run_at && (
                                    <span>Programado: {new Date(job.run_at).toLocaleString('es-ES')}</span>
                                  )}
                                  <span>Intentos: {job.attempts}/{job.max_attempts}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                {isExpanded ? <ChevronDown className="size-4 rotate-180 transition" /> : <ChevronDown className="size-4 transition" />}
                              </Button>
                            </div>
                          </div>

                          {/* Acordeón Payload & Error */}
                          {isExpanded && (
                            <div className="p-4 border-t border-border bg-muted/40 text-xs space-y-3">
                              {job.last_error && (
                                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
                                  <p className="font-semibold mb-1 flex items-center gap-1.5">
                                    <AlertTriangle className="size-3.5" />
                                    Último error registrado:
                                  </p>
                                  <p className="font-mono text-[11px] whitespace-pre-wrap">{job.last_error}</p>
                                </div>
                              )}

                              <div>
                                <p className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                  <Layers className="size-3.5" />
                                  Payload del Job (Datos del evento / correo)
                                </p>
                                <pre className="p-3 bg-zinc-950 text-zinc-200 font-mono text-[11px] rounded-lg overflow-x-auto border border-zinc-800">
                                  {JSON.stringify(job.payload || {}, null, 2)}
                                </pre>
                              </div>
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
          /* Pestaña 1: Tareas y Workflows */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lista */}
          <Card className="lg:col-span-1">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle>Historial de workflows</CardTitle>
              <CardDescription>Tareas generadas por el agente.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-3 max-h-[640px] overflow-y-auto">
              {loading && tasks.length === 0 ? (
                <>
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </>
              ) : tasks.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No hay workflows iniciados.
                </div>
              ) : (
                tasks.map((task) => {
                  const isActive = selectedTask && selectedTask.id === task.id;
                  const meta = statusLabel(task.status);
                  return (
                    <button
                      key={task.id}
                      onClick={() => selectTask(task)}
                      className={cn(
                        'text-left p-3.5 rounded-xl border transition',
                        isActive
                          ? 'border-primary/40 bg-muted/40'
                          : 'border-border bg-card hover:border-primary/30'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground truncate">
                          {task.id}
                        </span>
                        <Badge variant={meta.variant} className="text-[10px] shrink-0">
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{task.goal}</p>
                      <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" />
                        {new Date(task.created_at).toLocaleString('es')}
                      </p>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Detalle */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {selectedTask ? (
              <>
                {/* Encabezado del detalle */}
                <Card>
                  <CardHeader className="border-b border-border pb-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <CardTitle className="font-mono">{selectedTask.id}</CardTitle>
                        <CardDescription className="mt-1">{selectedTask.goal}</CardDescription>
                      </div>
                      <Badge variant={statusLabel(selectedTask.status).variant} className="shrink-0">
                        {statusLabel(selectedTask.status).label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-5">
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <Hash className="size-3" /> Tipo
                        </dt>
                        <dd className="text-sm font-medium text-foreground mt-1">{selectedTask.type}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <CircleDot className="size-3" /> Estado
                        </dt>
                        <dd className="text-sm font-medium text-foreground mt-1">{selectedTask.status}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <CircleDot className="size-3" /> Prioridad
                        </dt>
                        <dd className="text-sm font-medium text-foreground mt-1 capitalize">
                          {selectedTask.priority}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3" /> Creada
                        </dt>
                        <dd className="text-sm font-medium text-foreground mt-1">
                          {new Date(selectedTask.created_at).toLocaleString('es')}
                        </dd>
                      </div>
                    </dl>

                    {/* Progreso */}
                    <div className="mt-6 flex items-center gap-2">
                      {[1, 2, 3, 4].map((step) => {
                        const state = stepState(step);
                        return (
                          <React.Fragment key={step}>
                            {step > 1 && <div className="flex-1 h-0.5 bg-border rounded" />}
                            <div
                              className={cn(
                                'size-8 rounded-full flex items-center justify-center text-xs font-semibold border transition',
                                state === 'done' && 'bg-primary text-primary-foreground border-primary',
                                state === 'active' && 'bg-primary/10 text-primary border-primary/40 animate-pulse',
                                state === 'pending' && 'bg-muted text-muted-foreground border-border'
                              )}
                            >
                              {state === 'done' ? <CheckCircle2 className="size-4" /> : step}
                            </div>
                          </React.Fragment>
                        );
                      })}
                      <span className="ml-2 text-sm text-muted-foreground">
                        {selectedTask.status === 'waiting_human'
                          ? isEscalation
                            ? 'Intervención humana'
                            : 'Aprobación pendiente'
                          : selectedTask.status === 'completed'
                          ? 'Completada'
                          : 'Procesando'}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Escalación a humano */}
                {isEscalation && waitingHuman && (
                  <Card>
                    <CardHeader className="border-b border-border pb-4">
                      <div className="flex items-center gap-2">
                        <Headset className="size-5 text-muted-foreground" />
                        <CardTitle>Escalación a operador humano</CardTitle>
                      </div>
                      <CardDescription>
                        El cliente solicitó hablar con una persona. Abre la conversación, atiéndelo y cierra la escalación.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 flex flex-col gap-4">
                      <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/40 border border-border">
                        <div className="flex items-center gap-2 text-sm min-w-0">
                          <MessageSquare className="size-4 text-muted-foreground shrink-0" />
                          <span className="font-mono truncate">{selectedTask.conversation_id}</span>
                        </div>
                        <Link
                          href={`/conversations/${selectedTask.conversation_id}?human=1`}
                          transitionTypes={['nav-forward']}
                          className={buttonVariants({ size: 'sm' })}
                        >
                          <Headset />
                          Atender conversación
                          <ExternalLink />
                        </Link>
                      </div>

                      {selectedTask.context?.tool_args &&
                        Object.keys(selectedTask.context.tool_args).length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5">Motivo de la escalación</p>
                            <p className="text-sm text-foreground bg-muted/40 border border-border rounded-lg p-3">
                              {String(selectedTask.context.tool_args.razon ?? '—')}
                            </p>
                          </div>
                        )}

                      <Separator />

                      <div className="space-y-1.5">
                        <label className="text-sm text-muted-foreground">Comentario del operador</label>
                        <Input
                          placeholder="Ej: Cliente atendido, se resolvió la consulta"
                          value={approvalReason}
                          onChange={(e) => setApprovalReason(e.target.value)}
                        />
                      </div>

                      <div className="flex gap-3">
                        <Button
                          onClick={() => setPendingAction({ kind: 'escalation', decision: 'approve' })}
                          disabled={actionLoading}
                          className="flex-1"
                        >
                          <CheckCircle2 />
                          Marcar como atendido
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setPendingAction({ kind: 'escalation', decision: 'reject' })}
                          disabled={actionLoading}
                          className="flex-1"
                        >
                          <XCircle />
                          Descartar escalación
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Aprobación HITL */}
                {waitingHuman && !isEscalation && (
                  <Card>
                    <CardHeader className="border-b border-border pb-4">
                      <div className="flex items-center gap-2">
                        <UserCheck className="size-5 text-muted-foreground" />
                        <CardTitle>Aprobación humana requerida</CardTitle>
                      </div>
                      <CardDescription>
                        Este workflow requiere revisión antes de ejecutar la herramienta sensible.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 flex flex-col gap-4">
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border">
                        <span className="text-sm text-muted-foreground">Herramienta:</span>
                        <span className="font-mono text-sm text-foreground">{selectedTask.context?.tool_name}</span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm text-muted-foreground">Parámetros (editables)</label>
                        <Textarea
                          value={editedParams}
                          onChange={(e) => setEditedParams(e.target.value)}
                          className="h-32 font-mono text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm text-muted-foreground">Razón / comentarios</label>
                        <Input
                          placeholder="Ingresa un motivo para la decisión"
                          value={approvalReason}
                          onChange={(e) => setApprovalReason(e.target.value)}
                        />
                      </div>

                      <div className="flex gap-3">
                        <Button
                          onClick={() => setPendingAction({ kind: 'hitl', decision: 'approve' })}
                          disabled={actionLoading}
                          className="flex-1"
                        >
                          <CheckCircle2 />
                          Aprobar y ejecutar
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setPendingAction({ kind: 'hitl', decision: 'reject' })}
                          disabled={actionLoading}
                          className="flex-1"
                        >
                          <XCircle />
                          Rechazar tarea
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* JSON inspeccionable (colapsado por defecto) */}
                <Card>
                  <CardHeader className="pb-3">
                    <button
                      onClick={() => setShowJson((s) => !s)}
                      className="flex items-center justify-between w-full text-left"
                    >
                      <div>
                        <CardTitle>Detalle técnico</CardTitle>
                        <CardDescription>Datos completos de la tarea en formato JSON.</CardDescription>
                      </div>
                      <ChevronDown
                        className={cn('size-4 text-muted-foreground transition-transform', showJson && 'rotate-180')}
                      />
                    </button>
                  </CardHeader>
                  {showJson && (
                    <CardContent className="p-5 pt-0">
                      <pre className="bg-muted/40 border border-border rounded-lg p-4 font-mono text-xs text-foreground overflow-x-auto max-h-[320px]">
                        {JSON.stringify(selectedTask, null, 2)}
                      </pre>
                    </CardContent>
                  )}
                </Card>
              </>
            ) : (
              <Card className="h-48 border-dashed flex items-center justify-center text-muted-foreground">
                Selecciona un workflow para ver su detalle e interactuar.
              </Card>
            )}
          </div>
        </div>
      )}

        {/* Modal de confirmación de acciones */}
        <AlertDialog
          open={pendingAction !== null}
          onOpenChange={(open) => {
            if (!open) closePendingAction();
          }}
        >
          <AlertDialogPortal>
            <AlertDialogBackdrop />
            <AlertDialogPopup>
              {pendingAction && (() => {
                const copy = ACTION_COPY[pendingAction.kind][pendingAction.decision];
                const isReject = pendingAction.decision === 'reject';
                return (
                  <>
                    <div className="flex items-center gap-3">
                      <span
                        className={
                          isReject
                            ? 'size-10 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center shrink-0'
                            : 'size-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0'
                        }
                      >
                        {isReject ? <AlertTriangle /> : <CheckCircle2 />}
                      </span>
                      <AlertDialogTitle>{copy.title}</AlertDialogTitle>
                    </div>
                    <AlertDialogDescription>{copy.description}</AlertDialogDescription>
                    <div className="flex justify-end gap-3 pt-2">
                      <AlertDialogClose
                        render={
                          <Button variant="outline" disabled={actionLoading}>
                            Cancelar
                          </Button>
                        }
                      />
                      <Button
                        variant={isReject ? 'destructive' : 'default'}
                        onClick={() => decideHitl(pendingAction.decision)}
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <>
                            <span className="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            Procesando...
                          </>
                        ) : (
                          <>
                            {isReject ? <XCircle /> : <CheckCircle2 />}
                            {copy.confirm}
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </AlertDialogPopup>
          </AlertDialogPortal>
        </AlertDialog>
      </div>
    </PageTransition>
  );
}
