"""
DDL y esquemas SQL de PostgreSQL para Synckre Agent V2.
Crea la extensión pgvector y el esquema 'synckre' con todas las tablas necesarias.
"""

SETUP_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS synckre;

-- 1. USERS & ROLES
CREATE TABLE IF NOT EXISTS synckre.users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role_name VARCHAR(100) NOT NULL DEFAULT 'customer_support',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. CUSTOMERS
CREATE TABLE IF NOT EXISTS synckre.customers (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(80),
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. CONVERSATIONS & MESSAGES
CREATE TABLE IF NOT EXISTS synckre.conversations (
    id VARCHAR(255) PRIMARY KEY,
    channel VARCHAR(50) NOT NULL DEFAULT 'api',
    user_id VARCHAR(255),
    customer_id VARCHAR(255),
    role VARCHAR(100) NOT NULL DEFAULT 'customer_support',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON synckre.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON synckre.conversations(customer_id);

CREATE TABLE IF NOT EXISTS synckre.messages (
    id VARCHAR(255) PRIMARY KEY,
    conversation_id VARCHAR(255) NOT NULL REFERENCES synckre.conversations(id) ON DELETE CASCADE,
    sender VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(50) NOT NULL DEFAULT 'text',
    tool_calls JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON synckre.messages(conversation_id);

-- 4. CONTRACTS & VERSIONS
-- (Los leads ya no tienen tabla propia: se registran en synckre.memory
--  con entity_type='lead'; ver sección 10.)
CREATE TABLE IF NOT EXISTS synckre.contracts (
    id VARCHAR(255) PRIMARY KEY,
    customer_id VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    template_name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    created_by VARCHAR(255) DEFAULT 'agent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS synckre.contract_versions (
    id VARCHAR(255) PRIMARY KEY,
    contract_id VARCHAR(255) NOT NULL REFERENCES synckre.contracts(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. TASKS, TOOL EXECUTIONS & APPROVALS
CREATE TABLE IF NOT EXISTS synckre.tasks (
    id VARCHAR(255) PRIMARY KEY,
    conversation_id VARCHAR(255) NOT NULL REFERENCES synckre.conversations(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    goal TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    priority VARCHAR(50) NOT NULL DEFAULT 'normal',
    context JSONB DEFAULT '{}'::jsonb,
    result JSONB DEFAULT NULL,
    approval_required BOOLEAN DEFAULT FALSE,
    approval_status VARCHAR(50) DEFAULT NULL,
    temporal_workflow_id VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON synckre.tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON synckre.tasks(status);

CREATE TABLE IF NOT EXISTS synckre.tool_executions (
    id VARCHAR(255) PRIMARY KEY,
    task_id VARCHAR(255),
    conversation_id VARCHAR(255) NOT NULL,
    tool_name VARCHAR(100) NOT NULL,
    input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_data JSONB DEFAULT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'success',
    execution_time_ms INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS synckre.approvals (
    id VARCHAR(255) PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL REFERENCES synckre.tasks(id) ON DELETE CASCADE,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    requested_by VARCHAR(255) DEFAULT 'agent',
    approved_by VARCHAR(255),
    previous_value TEXT,
    new_value TEXT,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON synckre.approvals(status);

-- 7. KNOWLEDGE SOURCES & DOCUMENT CHUNKS (RAG)
CREATE TABLE IF NOT EXISTS synckre.knowledge_sources (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    domain VARCHAR(100) NOT NULL DEFAULT 'public',
    source_type VARCHAR(50) NOT NULL DEFAULT 'pdf',
    file_path VARCHAR(500),
    content_hash VARCHAR(64),
    status VARCHAR(50) DEFAULT 'indexed',
    chunk_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migración para tablas existentes (columna content_hash para dedupe de ingesta)
ALTER TABLE synckre.knowledge_sources ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

CREATE TABLE IF NOT EXISTS synckre.document_chunks (
    id BIGSERIAL PRIMARY KEY,
    source_id VARCHAR(255),
    filename VARCHAR(255) NOT NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),
    domain VARCHAR(100) NOT NULL DEFAULT 'public',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_domain ON synckre.document_chunks(domain);

-- Índice vectorial HNSW (pgvector) para búsqueda por similitud sin escaneo secuencial.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
    ON synckre.document_chunks USING hnsw (embedding vector_cosine_ops);

-- 8. AUDIT LOGS
CREATE TABLE IF NOT EXISTS synckre.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    agent_role VARCHAR(100) NOT NULL,
    tool_name VARCHAR(100),
    task_id VARCHAR(255),
    workflow_id VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    authorization_result VARCHAR(50) DEFAULT 'authorized',
    approval_id VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON synckre.audit_logs(timestamp DESC);

-- 9. RECORDATORIOS DE CITAS (emails automáticos: 1 día antes y minutos antes)
CREATE TABLE IF NOT EXISTS synckre.appointment_reminders (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(255),
    conversation_id VARCHAR(255),
    client_name VARCHAR(255),
    client_email VARCHAR(255) NOT NULL,
    appointment_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reminder_type VARCHAR(50) NOT NULL,          -- 'day_before' | 'minutes_before'
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    motivo TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migración para tablas existentes (columna motivo)
ALTER TABLE synckre.appointment_reminders ADD COLUMN IF NOT EXISTS motivo TEXT;

CREATE INDEX IF NOT EXISTS idx_reminders_due ON synckre.appointment_reminders(scheduled_for, sent_at);

-- Un solo recordatorio por (event_id, reminder_type): evita correos duplicados.
-- Primero se eliminan duplicados históricos (se conserva el de menor id).
DELETE FROM synckre.appointment_reminders a
USING synckre.appointment_reminders b
WHERE a.id > b.id AND a.event_id = b.event_id AND a.reminder_type = b.reminder_type;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reminders_event_type') THEN
        ALTER TABLE synckre.appointment_reminders
            ADD CONSTRAINT uq_reminders_event_type UNIQUE (event_id, reminder_type);
    END IF;
END $$;

-- 10. MEMORIA GENÉRICA (clientes, leads y otras entidades) por entidad Y por rol
-- Una sola tabla 'memory' reemplaza a customer_memory y a la tabla legacy prospects:
--   - entity_type='customer'  -> perfil persistente del cliente por rol (aislado)
--   - entity_type='lead'      -> leads (pipeline comercial) + datos del web form
--   - metadata JSONB          -> campos de pipeline: workflow_id, origen, erp_id, erp_destino, status
CREATE TABLE IF NOT EXISTS synckre.memory (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL DEFAULT 'customer',   -- 'customer' | 'lead' | ...
    entity_id VARCHAR(255),                                -- id de la entidad (customer_id, lead_id, ...)
    email VARCHAR(255),
    role_name VARCHAR(100) NOT NULL DEFAULT 'customer_support',
    name VARCHAR(255),
    company VARCHAR(255),
    phone VARCHAR(80),
    preferences JSONB DEFAULT '{}'::jsonb,
    summary TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    last_interaction TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Un cliente tiene UN perfil por rol (para upsert/merge); los leads pueden
-- repetir email (pipeline: varios leads del mismo contacto).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_customer_email_role
    ON synckre.memory(email, role_name)
    WHERE entity_type = 'customer';

CREATE INDEX IF NOT EXISTS idx_memory_entity_email ON synckre.memory(entity_type, email);
CREATE INDEX IF NOT EXISTS idx_memory_email_role ON synckre.memory(email, role_name);

-- Migración desde tablas legacy (customer_memory y prospects) -> memory.
-- Es idempotente: solo copia si la tabla legacy aún existe y solo inserta filas nuevas.
DO $$
BEGIN
    IF to_regclass('synckre.customer_memory') IS NOT NULL THEN
        INSERT INTO synckre.memory
            (entity_type, entity_id, email, role_name, name, company, phone,
             preferences, summary, last_interaction, created_at, updated_at)
        SELECT 'customer', customer_id, email, role_name, name, company, phone,
               preferences, summary, last_interaction, created_at, updated_at
        FROM synckre.customer_memory
        ON CONFLICT (email, role_name) WHERE entity_type = 'customer' DO NOTHING;
    END IF;

    IF to_regclass('synckre.prospects') IS NOT NULL THEN
        INSERT INTO synckre.memory
            (entity_type, entity_id, email, role_name, name, company, phone,
             summary, metadata, last_interaction, created_at, updated_at)
        SELECT 'lead', id::text, email, 'customer_support', nombre, empresa, telefono,
               mensaje,
               jsonb_build_object('workflow_id', workflow_id, 'origen', origen,
                                  'erp_id', erp_id, 'erp_destino', erp_destino, 'status', status),
               created_at, created_at, created_at
        FROM synckre.prospects p
        WHERE NOT EXISTS (
            SELECT 1 FROM synckre.memory m
            WHERE m.entity_type = 'lead' AND m.email = p.email
              AND m.name = p.nombre AND m.created_at = p.created_at
        );
    END IF;
END $$;

-- Renombrar entity_type 'prospect' -> 'lead' en filas ya migradas (idempotente).
UPDATE synckre.memory SET entity_type = 'lead' WHERE entity_type = 'prospect';

-- Eliminar las tablas legacy una vez migradas (no se vuelven a crear).
DROP TABLE IF EXISTS synckre.customer_memory;
DROP TABLE IF EXISTS synckre.prospects;

-- 11. GESTIÓN DE API KEYS (Plataforma y Agentes)
CREATE TABLE IF NOT EXISTS synckre.api_keys (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(64) UNIQUE NOT NULL,
    prefix VARCHAR(20) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'public',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON synckre.api_keys(key_hash);
"""
