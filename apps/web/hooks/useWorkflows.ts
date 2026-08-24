'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import type { WorkflowTask } from '@/lib/types';

export type WorkflowPendingAction = {
  kind: 'escalation' | 'hitl';
  decision: 'approve' | 'reject';
};

function paramsFromTask(task: WorkflowTask | null): string {
  if (!task?.context) return '';
  return JSON.stringify(task.context.tool_args || {}, null, 2);
}

export function useWorkflows(initialTasks: WorkflowTask[]) {
  const [tasks, setTasks] = useState<WorkflowTask[]>(initialTasks);
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(initialTasks[0] ?? null);
  const [loading, setLoading] = useState(false);
  const [approvalReason, setApprovalReason] = useState('');
  const [editedParams, setEditedParams] = useState(paramsFromTask(initialTasks[0] ?? null));
  const [actionLoading, setActionLoading] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [pendingAction, setPendingAction] = useState<WorkflowPendingAction | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listTasks();
      setTasks(data || []);
      if (data && data.length > 0) {
        if (!selectedTask) {
          setSelectedTask(data[0]);
          setEditedParams(paramsFromTask(data[0]));
        } else {
          const updated = data.find((t: WorkflowTask) => t.id === selectedTask.id);
          if (updated) setSelectedTask(updated);
        }
      }
    } catch (err) {
      console.error('Error cargando workflows:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectTask = (task: WorkflowTask) => {
    setSelectedTask(task);
    setApprovalReason('');
    setEditedParams(paramsFromTask(task));
  };

  const decideHitl = async (decision: 'approve' | 'reject') => {
    if (!selectedTask || actionLoading) return;

    setActionLoading(true);
    try {
      const approvals = await api.listApprovals('pending');
      const matching = approvals.find(
        (a: { id: string; task_id: string }) => a.task_id === selectedTask.id,
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
      await refresh();
    } catch (err) {
      console.error(err);
      window.alert(`Error al procesar decisión: ${errorMessage(err, String(err))}`);
    } finally {
      setActionLoading(false);
    }
  };

  const closePendingAction = () => {
    if (!actionLoading) setPendingAction(null);
  };

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

  return {
    tasks,
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
  };
}
