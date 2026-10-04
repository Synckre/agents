/**
 * DDL aplicado al arrancar PostgresMemoryStore / PgVectorKnowledgeBase.
 * El vector de embeddings usa 768 dimensiones (nomic-embed-text).
 */
export const POSTGRES_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(768),
  source TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_tags_idx ON knowledge_chunks USING GIN (tags);
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON knowledge_chunks (source);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tags TEXT[] NOT NULL,
  drive_modified_time TIMESTAMPTZ NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS knowledge_sources_status_idx ON knowledge_sources (status);

CREATE TABLE IF NOT EXISTS scheduled_followups (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  appointment_id TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  action TEXT NOT NULL,
  context TEXT NOT NULL,
  template_id TEXT,
  language TEXT NOT NULL DEFAULT 'es',
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE scheduled_followups ADD COLUMN IF NOT EXISTS appointment_id TEXT;

CREATE INDEX IF NOT EXISTS scheduled_followups_due_idx 
  ON scheduled_followups (due_at) 
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS scheduled_followups_appt_idx
  ON scheduled_followups (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- =============================================================================
-- Política de agendamiento (configurable en base de datos)
--
-- Diseñada como tablas de filas editables, no como un JSON monolítico, para que
-- un panel de configuración pueda editar cada día, cada tipo de cita y cada
-- festivo por separado sin reescribir el resto de la política.
--
-- Autoridad: si existe la fila de scheduling_settings, la base de datos manda.
-- Si no existe, se usan los valores por defecto del código (así el sistema
-- funciona antes de que nadie configure nada).
-- =============================================================================

CREATE TABLE IF NOT EXISTS scheduling_settings (
  -- Fila única: el identificador siempre es 'default'.
  id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  max_appointments_per_day INT,
  slot_interval_minutes INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduling_business_hours (
  -- Un registro por día de la semana (mon..sun).
  weekday TEXT PRIMARY KEY,
  is_open BOOLEAN NOT NULL DEFAULT false,
  open_time TEXT,
  close_time TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduling_appointment_types (
  id TEXT PRIMARY KEY,
  name TEXT,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  max_concurrent INT NOT NULL DEFAULT 1 CHECK (max_concurrent > 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduling_holidays (
  holiday_date DATE PRIMARY KEY,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tool_security_logs (
  id BIGSERIAL PRIMARY KEY,
  tool_name TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  reason TEXT,
  args JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_security_logs_conv_idx 
  ON tool_security_logs (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tool_security_logs_tool_idx 
  ON tool_security_logs (tool_name, created_at DESC);
`;

export const KNOWLEDGE_HNSW_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
`;
