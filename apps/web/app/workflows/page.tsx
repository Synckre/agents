'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  conversation_id: string;
  type: string;
  goal: string;
  status: string;
  priority: string;
  context?: { tool_name?: string; tool_args?: Record<string, unknown> };
  created_at: string;
  [key: string]: unknown;
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' }> = {
  waiting_human: { label: 'En espera de humano', variant: 'warning' },
  completed: { label: 'Completada', variant: 'success' },
  failed: { label: 'Fallida', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
  pending: { label: 'Pendiente', variant: 'outline' },
  running: { label: 'En curso', variant: 'info' },
};

function statusLabel(status: string) {
  return STATUS_META[status] || { label: status, variant: 'outline' as const };
}
export default function WorkflowsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvalReason, setApprovalReason] = useState('');
  const [editedParams, setEditedParams] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    kind: 'escalation' | 'hitl';
    decision: 'approve' | 'reject';
  } | null>(null);

  const loadWorkflows = async () => {
    setLoading(true);
    try {
      const data = await api.listTasks();
      setTasks(data || []);
      if (data && data.length > 0) {
        if (!selectedTask) {
          setSelectedTask(data[0]);
          if (data[0].context) {
            setEditedParams(JSON.stringify(data[0].context.tool_args || {}, null, 2));
          }
        } else {
          const updated = data.find((t: Task) => t.id === selectedTask.id);
          if (updated) setSelectedTask(updated);
        }
      }
    } catch (err) {
      console.error('Error cargando workflows:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (cancelled) return;
      await loadWorkflows();
    };
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    setApprovalReason('');
    if (task.context) {
      setEditedParams(JSON.stringify(task.context.tool_args || {}, null, 2));
    }
  };

  const handleHITLDecision = async (decision: 'approve' | 'reject') => {
    if (!selectedTask || actionLoading) return;

    setActionLoading(true);
    try {
      const approvals = await api.listApprovals('pending');
      const matching = approvals.find(
        (a: { id: string; task_id: string }) => a.task_id === selectedTask.id
      );

      if (!matching) {
        setPendingAction(null);
        window.alert('No se encontró ninguna solicitud de aprobación pendiente para este workflow.');
        return;
      }

      if (decision === 'approve') {
        await api.approveRequest(matching.id, 'admin', approvalReason, editedParams);
      } else {
        await api.rejectRequest(matching.id, 'admin', approvalReason);
      }

      setPendingAction(null);
      await loadWorkflows();
    } catch (err) {
      console.error(err);
      window.alert(`Error al procesar decisión: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

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

  const isEscalation = selectedTask?.type === 'human_escalation';
  const waitingHuman = selectedTask?.status === 'waiting_human';

  const stepState = (step: number) => {
    if (selectedTask?.status === 'completed') return step <= 4 ? 'done' : 'pending';
    if (selectedTask?.status === 'waiting_human') {
      if (step <= 2) return 'done';
      if (step === 3) return 'active';
      return 'pending';
    }
    if (selectedTask?.status === 'failed' || selectedTask?.status === 'cancelled') {
      return step <= 2 ? 'done' : 'active';
    }
    return step === 1 ? 'active' : 'pending';
  };

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={GitBranch}
          title="Workflows y tareas"
          description="Seguimiento de procesos, tareas y aprobaciones del Agent Runtime."
          right={
            <Button
              variant="outline"
              size="icon"
              onClick={loadWorkflows}
              disabled={loading}
              title="Refrescar workflows"
              aria-label="Refrescar workflows"
              className="size-9 rounded-lg border-border"
            >
              <RefreshCw className={cn("size-4", loading && 'animate-spin')} />
            </Button>
          }
        />

        {/* Responsive Grid / Stack */}
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
                      onClick={() => handleSelectTask(task)}
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

        {/* Modal de confirmación de acciones */}
        <AlertDialog
          open={pendingAction !== null}
          onOpenChange={(open) => {
            if (!open && !actionLoading) setPendingAction(null);
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
                        onClick={() => handleHITLDecision(pendingAction.decision)}
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
