export type ConversationSummary = {
  id: string;
  role: string;
  updated_at: string;
};

export type AuditLog = {
  id: string | number;
  action: string;
  agent_role: string;
  tool_name?: string | null;
  user_id?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  authorization_result: string;
  timestamp: string;
};

export type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  is_active: boolean;
  created_at: string;
  raw_key?: string;
};

export type KnowledgeSource = {
  id: string;
  title: string;
  domain: string;
  source_type: string;
  status: string;
  chunk_count: number;
  created_at: string;
};

export type WorkflowTask = {
  id: string;
  conversation_id: string;
  type: string;
  goal: string;
  status: string;
  priority: string;
  context?: { tool_name?: string; tool_args?: Record<string, unknown> };
  created_at: string;
  [key: string]: unknown;
};

export type ToolCall = {
  tool: string;
  status?: string;
  result?: unknown;
  task_id?: string;
};

export type ChatMessage = {
  id: string;
  sender: string;
  content: string;
  created_at?: string;
  tool_calls?: ToolCall[];
};

export type AgentRole = {
  name: string;
  title?: string;
  description: string;
  system_policy?: string;
  allowed_tools: string[];
  allowed_knowledge_sources?: string[];
  autonomy_level?: number;
  autonomy_label?: string;
  approval_policy?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type TelemetryLog = {
  id?: string;
  task_id?: string | null;
  conversation_id?: string | null;
  tool_name: string;
  status: string;
  created_at: string;
  execution_time_ms: number;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown> | null;
};

export type BackgroundJob = {
  id: string;
  kind: string;
  status: string;
  run_at?: string | null;
  payload?: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  idempotency_key?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};




export type DashboardStats = {
  erp_mutations: number;
  calendar_bookings: number;
  emails_sent: number;
  rag_queries: number;
  agent_runs_24h: number;
  avg_run_duration_ms: number;
  llm_fallback_total: number;
  pending_approvals: number;
};

export const EMPTY_STATS: DashboardStats = {
  erp_mutations: 0,
  calendar_bookings: 0,
  emails_sent: 0,
  rag_queries: 0,
  agent_runs_24h: 0,
  avg_run_duration_ms: 0,
  llm_fallback_total: 0,
  pending_approvals: 0,
};
