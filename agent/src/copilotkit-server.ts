import { startCopilotKitServer } from '@adapters/http/copilotkit-endpoint';
import { env } from '@config/env';
import { createSystem } from './create-system';

/**
 * Punto de entrada HTTP independiente para CopilotKit (Node.js runtime).
 * Reutiliza las instancias de persistencia, seguridad y grafo compilado de createSystem().
 */
async function bootstrap(): Promise<void> {
  if (env.NODE_ENV === 'production' && env.SESSION_SECRET === 'dev-session-secret-change-me') {
    throw new Error('SESSION_SECRET must be set to a strong value in production');
  }

  const system = await createSystem();
  const server = startCopilotKitServer({
    executeConversation: system.executeConversation,
    compiledGraph: system.compiledGraph,
    memory: system.memory,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
    sessionSecret: env.SESSION_SECRET,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    exposeErrorDetails: env.NODE_ENV !== 'production',
    agentName: 'front_agent',
    endpointPath: '/api/copilotkit',
  });

  console.log(`front_agent CopilotKit endpoint listening on :${env.PORT} (/api/copilotkit) (${env.NODE_ENV})`);
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
  console.error('Failed to start the CopilotKit server:', error);
  process.exit(1);
});
