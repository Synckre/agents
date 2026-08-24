import { serverApi } from '@/lib/server-api';
import { EMPTY_STATS } from '@/lib/types';
import { DashboardView } from './dashboard-view';

export default async function DashboardPage() {
  const [stats, conversations, auditLogs] = await Promise.all([
    serverApi.analyticsStats(),
    serverApi.conversations(),
    serverApi.auditLogs(),
  ]);

  return (
    <DashboardView
      initialStats={{
        ...EMPTY_STATS,
        ...(stats || {}),
      }}
      initialConversations={conversations || []}
      initialAuditLogs={(auditLogs || []) as never}
    />
  );
}
