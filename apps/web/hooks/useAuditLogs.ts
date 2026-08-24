'use client';

import { useMemo, useState } from 'react';
import type { AuditLog } from '@/lib/types';

export type AuditResultFilter = 'all' | 'authorized' | 'approval_requested' | 'denied';

export function useAuditLogs(initialLogs: AuditLog[]) {
  const [logs] = useState<AuditLog[]>(initialLogs);
  const [loading] = useState(false);
  const [filter, setFilter] = useState<AuditResultFilter>('all');
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());

  const filtered = useMemo(
    () => logs.filter((log) => (filter === 'all' ? true : log.authorization_result === filter)),
    [logs, filter],
  );

  const counts = useMemo(
    () => ({
      total: logs.length,
      authorized: logs.filter((l) => l.authorization_result === 'authorized').length,
      approval: logs.filter((l) => l.authorization_result === 'approval_requested').length,
      denied: logs.filter((l) => l.authorization_result === 'denied').length,
    }),
    [logs],
  );

  const toggle = (id: string | number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { logs, loading, filter, setFilter, expanded, filtered, counts, toggle };
}
