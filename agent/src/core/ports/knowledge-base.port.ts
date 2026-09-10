/**
 * Fragmento recuperado de la base de conocimiento.
 */
export interface KnowledgeChunk {
  readonly id: string;
  readonly content: string;
  readonly source?: string;
  readonly tags: string[];
  readonly score?: number;
}

export interface InsertKnowledgeChunkInput {
  readonly content: string;
  readonly embedding: number[];
  readonly tags: string[];
}

export interface KnowledgeSourceRecord {
  readonly sourceId: string;
  readonly name: string;
  readonly tags: string[];
  readonly driveModifiedTime: Date;
  readonly lastSyncedAt: Date;
  readonly status: 'active' | 'deleted';
}

export interface SaveKnowledgeSourceInput {
  readonly sourceId: string;
  readonly name: string;
  readonly tags: string[];
  readonly driveModifiedTime: Date;
  readonly status?: 'active' | 'deleted';
}

/**
 * Puerto de salida para búsqueda semántica sobre documentos ingeridos (RAG)
 * y operaciones de escritura requeridas para la sincronización de fuentes.
 */
export interface IKnowledgeBase {
  search(query: string, tags?: string[]): Promise<KnowledgeChunk[]>;
  deleteBySourceId(sourceId: string): Promise<void>;
  insertChunks(sourceId: string, chunks: Array<{ content: string; embedding: number[]; tags: string[] }>): Promise<void>;
  getSource?(sourceId: string): Promise<KnowledgeSourceRecord | null>;
  listSources?(tag?: string): Promise<KnowledgeSourceRecord[]>;
  saveSource?(source: SaveKnowledgeSourceInput): Promise<void>;
}
