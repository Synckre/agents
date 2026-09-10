import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { OllamaEmbeddingAdapter } from '@adapters/embeddings/ollama.adapter';
import { PgVectorKnowledgeBase } from '@adapters/knowledge/pgvector-knowledge-base.adapter';
import { createPgPool } from '@adapters/persistence/create-pg-pool';

dotenv.config();

const ingestEnv = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
}).parse(process.env);

interface CliOptions {
  dir: string;
  tag?: string;
  chunkSize: number;
  overlap: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dir: path.resolve('knowledge'),
    chunkSize: 1200,
    overlap: 200,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dir' && next) {
      options.dir = path.resolve(next);
      i += 1;
    } else if (arg === '--tag' && next) {
      options.tag = next;
      i += 1;
    } else if (arg === '--chunk-size' && next) {
      options.chunkSize = Number(next);
      i += 1;
    } else if (arg === '--overlap' && next) {
      options.overlap = Number(next);
      i += 1;
    }
  }

  return options;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (/\.(md|txt|markdown|pdf)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function inferTag(filePath: string, override?: string): string {
  if (override) {
    return override;
  }
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/internal/')) {
    return 'internal';
  }
  return 'public';
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let buffer = '';

  const flush = (): void => {
    const piece = buffer.trim();
    if (piece) {
      chunks.push(piece);
    }
    buffer = overlap > 0 && piece.length > overlap ? piece.slice(-overlap) : '';
  };

  for (const paragraph of paragraphs) {
    if ((buffer + '\n\n' + paragraph).length > chunkSize && buffer) {
      flush();
    }
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  flush();

  return chunks;
}

async function readSource(filePath: string): Promise<string> {
  if (filePath.toLowerCase().endsWith('.pdf')) {
    const { PDFParse } = await import('pdf-parse');
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text ?? '';
    } finally {
      await parser.destroy();
    }
  }
  return readFile(filePath, 'utf8');
}

function chunkId(source: string, index: number, content: string): string {
  return createHash('sha256').update(`${source}:${index}:${content}`).digest('hex').slice(0, 32);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const info = await stat(options.dir);
  if (!info.isDirectory()) {
    throw new Error(`Not a directory: ${options.dir}`);
  }

  const files = await listFiles(options.dir);
  if (files.length === 0) {
    console.log(`No documents found in ${options.dir}`);
    return;
  }

  const pool = createPgPool(ingestEnv.DATABASE_URL);
  const embeddings = new OllamaEmbeddingAdapter({
    baseUrl: ingestEnv.OLLAMA_BASE_URL,
    model: ingestEnv.OLLAMA_EMBED_MODEL,
    dimensions: ingestEnv.EMBEDDING_DIMENSIONS,
  });
  const knowledge = new PgVectorKnowledgeBase(pool, embeddings);

  let stored = 0;
  try {
    for (const file of files) {
      const tag = inferTag(file, options.tag);
      const source = path.relative(options.dir, file);
      const text = await readSource(file);
      const chunks = chunkText(text, options.chunkSize, options.overlap);
      console.log(`${source}: ${chunks.length} chunks (tag=${tag})`);

      for (const [index, content] of chunks.entries()) {
        const embedding = await embeddings.embed(content);
        stored += await knowledge.upsert([
          {
            id: chunkId(source, index, content),
            content,
            source,
            tags: [tag],
            embedding,
          },
        ]);
      }
    }
    console.log(`Ingested ${stored} chunks from ${files.length} files`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Knowledge ingest failed:', error);
  process.exit(1);
});
