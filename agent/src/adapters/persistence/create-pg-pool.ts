import { Pool } from 'pg';

export function createPgPool(connectionString: string): Pool {
  const isRemote =
    !connectionString.includes('localhost') &&
    !connectionString.includes('127.0.0.1') &&
    !connectionString.includes('sslmode=disable');
  const isNeon = connectionString.includes('neon.tech');

  const pool = new Pool({
    connectionString,
    max: isNeon ? 5 : 10,
    idleTimeoutMillis: isNeon ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  // Neon/pg-bouncer drop idle sockets. Without this listener, `pg` emits an
  // unhandled 'error' and the process exits (Docker restart loop).
  pool.on('error', (error) => {
    console.error('[pg] idle client error:', error.message);
  });

  return pool;
}
