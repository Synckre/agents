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

CREATE INDEX IF NOT EXISTS scheduled_followups_due_idx 
  ON scheduled_followups (due_at) 
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS scheduled_followups_appt_idx
  ON scheduled_followups (appointment_id)
  WHERE appointment_id IS NOT NULL;
