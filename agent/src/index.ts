import { startChatboxServer } from '@adapters/http/chatbox-server';
import { env } from '@config/env';
import { createSystem } from './create-system';

/**
 * Punto de entrada HTTP del chatbox (front_agent).
 */
async function bootstrap(): Promise<void> {
  console.log('[boot] starting front_agent');

  if (env.NODE_ENV === 'production' && env.SESSION_SECRET === 'dev-session-secret-change-me') {
    throw new Error('SESSION_SECRET must be set to a strong value in production');
  }

  if (!env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required (Neon connection string)');
  }

  const listenPort = env.PORT === 80 || env.PORT === 443 ? 3000 : env.PORT;
  if (listenPort !== env.PORT) {
    console.warn(`[boot] ignoring PORT=${env.PORT}; listening on ${listenPort}`);
  }

  const system = await createSystem();
  const server = startChatboxServer({
    executeConversation: system.executeConversation,
    processWebsiteContact: system.processWebsiteContact,
    publicApiKey: env.SYNCKRE_API_KEY,
    memory: system.memory,
    port: listenPort,
    host: env.HOST,
    corsOrigins: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
    sessionSecret: env.SESSION_SECRET,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    exposeErrorDetails: env.NODE_ENV !== 'production',
    model: 'front_agent',
    checkReady: system.checkReady,
  });

  console.log(`front_agent server listening on ${env.HOST}:${listenPort} (/health, /api/copilotkit, /api/v1/public/contact) (${env.NODE_ENV})`);
  console.log(`LLM: ${env.LLM_PROVIDER} / ${env.LLM_MODEL}`);

  const shutdown = async (): Promise<void> => {
    server.close();
    await system.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start the agent system:', error);
  process.exit(1);
});
