import React from 'react';
import { serverApi } from '@/lib/server-api';
import { WorkflowsView } from './workflows-view';
import type { BackgroundJob, WorkflowTask } from '@/lib/types';

export default async function WorkflowsPage() {
  const [tasks, jobs] = await Promise.all([
    serverApi.tasks().catch(() => []),
    serverApi.jobs().catch(() => []),
  ]);

  return (
    <WorkflowsView
      initialTasks={(tasks as WorkflowTask[]) || []}
      initialJobs={(jobs as BackgroundJob[]) || []}
    />
  );
}

