import { serverApi } from '@/lib/server-api';
import { WorkflowsView } from './workflows-view';

export default async function WorkflowsPage() {
  const tasks = ((await serverApi.tasks()) || []) as Parameters<typeof WorkflowsView>[0]['initialTasks'];
  return <WorkflowsView initialTasks={tasks} />;
}
