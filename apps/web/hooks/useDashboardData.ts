'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { EMPTY_STATS, type AuditLog, type ConversationSummary, type DashboardStats } from '@/lib/types';

export function useDashboardData({
  initialStats,
  initialConversations,
  initialAuditLogs,
}: {
  initialStats: DashboardStats;
  initialConversations: ConversationSummary[];
  initialAuditLogs: AuditLog[];
}) {
  const [stats, setStats] = useState(initialStats || EMPTY_STATS);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations || []);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(initialAuditLogs || []);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [statsData, convsData, auditData] = await Promise.allSettled([
        api.getAnalyticsStats(),
        api.listConversations(),
        api.listAuditLogs(),
      ]);

      if (statsData.status === 'fulfilled') setStats(statsData.value);
      if (convsData.status === 'fulfilled') setConversations(convsData.value);
      if (auditData.status === 'fulfilled') setAuditLogs(auditData.value);
    } catch (err) {
      console.error('Error cargando telemetría del dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  return { stats, conversations, auditLogs, loading, refresh };
}
