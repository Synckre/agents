import { GraphBuilder, CompiledAgentGraph } from '@adapters/graph/graph-builder';
import { LangGraphRuntimeAdapter } from '@adapters/graph/langgraph-runtime.adapter';
import { createLlmProvider } from '@adapters/llm/create-llm-provider';
import { createPgPool } from '@adapters/persistence/create-pg-pool';
import { buildExternalAdapters } from './bootstrap/build-external-adapters';
import { buildFrontAgent } from './bootstrap/build-front-agent';
import { buildPersistence } from './bootstrap/build-persistence';
import { buildSecurityLayer } from './bootstrap/build-security-layer';
import { env } from '@config/env';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { IToolSecurityLogger } from '@core/ports/tool-security-logger.port';
import { ExecuteConversationUseCase } from '@core/use-cases/execute-conversation.use-case';
import { ProcessWebsiteContactUseCase } from '@core/use-cases/process-website-contact.use-case';

export interface AgentSystem {
  readonly memory: IMemoryStore;
  readonly executeConversation: ExecuteConversationUseCase;
  readonly processWebsiteContact: ProcessWebsiteContactUseCase;
  readonly securityLogger: IToolSecurityLogger;
  readonly compiledGraph: CompiledAgentGraph;
  readonly checkReady: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * Composition root: orquesta los builders de persistencia, adapters externos,
 * capa de seguridad, front_agent y el caso de uso de conversación.
 */
export async function createSystem(): Promise<AgentSystem> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to persist conversations in Postgres');
  }

  const pool = createPgPool(env.DATABASE_URL);
  const persistence = buildPersistence(pool);
  const externalAdapters = buildExternalAdapters();
  const security = buildSecurityLayer(persistence.memory, pool);
  const llm = createLlmProvider();

  const { agent } = buildFrontAgent({
    llm,
    ...persistence,
    ...externalAdapters,
    ...security,
  });

  const graph = new GraphBuilder().addAgent(agent).build();
  const executeConversation = new ExecuteConversationUseCase(
    persistence.memory,
    new LangGraphRuntimeAdapter(graph, env.MAX_TOOL_ITERATIONS),
  );
  const processWebsiteContact = new ProcessWebsiteContactUseCase(
    externalAdapters.crm,
    externalAdapters.email,
    externalAdapters.internalAlertEmail,
  );

  return {
    memory: persistence.memory,
    executeConversation,
    processWebsiteContact,
    securityLogger: security.securityLogger,
    compiledGraph: graph,
    checkReady: async () => {
      await pool.query('SELECT 1');
    },
    close: async () => {
      try {
        await pool.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[pg] pool end:', message);
      }
    },
  };
}
