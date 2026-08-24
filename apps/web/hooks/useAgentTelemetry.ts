'use client';

import { useState, useMemo } from 'react';
import { api } from '@/lib/api';
import type { AgentRole, TelemetryLog } from '@/lib/types';

export function useAgentTelemetry({
  initialStats,
  initialToolExecutions,
  initialRoles,
}: {
  initialStats?: Record<string, number>;
  initialToolExecutions?: TelemetryLog[];
  initialRoles?: AgentRole[];
}) {
  const [stats, setStats] = useState<Record<string, number>>(initialStats || {});
  const [executions, setExecutions] = useState<TelemetryLog[]>(initialToolExecutions || []);
  const [roles, setRoles] = useState<AgentRole[]>(initialRoles || []);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [statsRes, execsRes, rolesRes] = await Promise.allSettled([
        api.getAnalyticsStats(),
        api.listToolExecutions(undefined, 100),
        api.listRoles(),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value || {});
      if (execsRes.status === 'fulfilled') setExecutions(execsRes.value || []);
      if (rolesRes.status === 'fulfilled' && Array.isArray(rolesRes.value)) {
        setRoles(rolesRes.value);
      }
    } catch (err) {
      console.error('Error refrescando telemetría de agentes:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredExecutions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return executions.filter((exec) => {
      const matchesQuery =
        !query ||
        (exec.tool_name || '').toLowerCase().includes(query) ||
        (exec.conversation_id || '').toLowerCase().includes(query) ||
        (exec.task_id || '').toLowerCase().includes(query);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'success' && (exec.status === 'success' || exec.status === 'authorized')) ||
        (statusFilter === 'failure' && exec.status !== 'success' && exec.status !== 'authorized');
      return matchesQuery && matchesStatus;
    });
  }, [executions, searchQuery, statusFilter]);

  const metrics = useMemo(() => {
    const totalExecs = Number(stats.total_executions || executions.length || 0);
    const failedExecs = Number(stats.failed_executions || 0);
    const successRate = totalExecs > 0 ? (((totalExecs - failedExecs) / totalExecs) * 100).toFixed(1) : '100';
    const avgToolTime = Number(stats.avg_execution_time_ms || 0).toFixed(0);
    const runs24h = Number(stats.agent_runs_24h || 0);
    const totalRuns = Number(stats.agent_runs_total || 0);
    const llmCalls = Number(stats.llm_calls_total || 0);
    const totalTokens = Number(stats.prompt_tokens_total || 0) + Number(stats.completion_tokens_total || 0);

    return {
      totalExecs,
      failedExecs,
      successRate,
      avgToolTime,
      runs24h,
      totalRuns,
      llmCalls,
      totalTokens,
    };
  }, [stats, executions]);

  const toggleExpand = (id: string | number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return {
    stats,
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
  };
}
