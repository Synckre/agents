-- Activa la extensión pgvector para soporte de vectores de alta dimensión
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla de fuentes de documentos para control de duplicados e ingesta incremental por hash
CREATE TABLE IF NOT EXISTS document_sources (
    id BIGSERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    domain VARCHAR(50) NOT NULL CHECK (domain IN ('public', 'internal')),
    content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_source_domain_filename UNIQUE (domain, filename)
);

-- Tabla de fragmentos de texto (chunks) y sus embeddings vectoriales
CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    domain VARCHAR(50) NOT NULL CHECK (domain IN ('public', 'internal')),
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024), -- Dimensión adaptada al modelo local (ej: qwen3-embedding / bge-m3)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índice HNSW con la métrica de Similitud Coseno para búsquedas vectoriales ultrarrápidas
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw 
ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- Índice compuesto de Seguridad por Dominio + Fuente para filtrado estricto e instantáneo
CREATE INDEX IF NOT EXISTS idx_document_chunks_domain_source 
ON document_chunks (domain, filename);
