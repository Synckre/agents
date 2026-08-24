import { serverApi } from '@/lib/server-api';
import { AuditView } from './audit-view';

export default async function AuditPage() {
  const logs = ((await serverApi.auditLogs()) || []) as Parameters<typeof AuditView>[0]['initialLogs'];
  return <AuditView initialLogs={logs} />;
}
