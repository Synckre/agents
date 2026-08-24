import React from 'react';
import { serverApi } from '@/lib/server-api';
import { AgentsView } from './agents-view';
import type { AgentRole, TelemetryLog } from '@/lib/types';

export default async function AgentsPage() {
  const [stats, toolExecutions, roles] = await Promise.all([
    serverApi.analyticsStats().catch(() => ({})),
    serverApi.toolExecutions(100).catch(() => []),
    serverApi.roles().catch(() => []),
  ]);

  return (
    <AgentsView
      initialStats={(stats as Record<string, number>) || {}}
      initialToolExecutions={(toolExecutions as TelemetryLog[]) || []}
      initialRoles={(roles as AgentRole[]) || []}
    />
  );
}


