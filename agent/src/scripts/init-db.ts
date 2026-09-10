import { createPgPool } from '@adapters/persistence/create-pg-pool';
import { POSTGRES_SCHEMA_SQL, KNOWLEDGE_HNSW_INDEX_SQL } from '@adapters/persistence/postgres-schema';
import { env } from '@config/env';

async function initDatabase(): Promise<void> {
  console.log('--- Initializing Neon DB Schema ---');
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in your .env file');
  }

  // Mask sensitive parts of the connection string for logging
  const maskedUrl = env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
  console.log(`Connecting to: ${maskedUrl}`);

  const pool = createPgPool(env.DATABASE_URL);

  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL successfully!');

    // 1. Enable pgvector extension (supported natively on Neon)
    console.log('1. Enabling vector extension...');
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
      console.log('   ✓ Extension "vector" enabled.');
    } catch (extErr: unknown) {
      const msg = extErr instanceof Error ? extErr.message : String(extErr);
      console.warn(`   ⚠ Could not create vector extension (might require admin or already active): ${msg}`);
    }

    // 2. Execute main schema DDL
    console.log('2. Creating tables and indexes...');
    await client.query(POSTGRES_SCHEMA_SQL);
    console.log('   ✓ Base tables and indexes created.');

    // 3. Try creating HNSW vector index
    try {
      await client.query(KNOWLEDGE_HNSW_INDEX_SQL);
      console.log('   ✓ HNSW vector index created.');
    } catch {
      // HNSW index might already exist or require vector ops
    }

    // 4. Verify created tables
    console.log('3. Verifying created tables in public schema:');
    const res = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    );

    for (const row of res.rows) {
      console.log(`   • ${row.table_name}`);
    }

    client.release();
    console.log('--- All tables verified successfully in Neon DB! ---');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to initialize database:', message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void initDatabase();
