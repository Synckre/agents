import type { Pool } from 'pg';
import { ConversationRateLimitPolicy } from '@adapters/tools/policies/conversation-rate-limit.policy';
import { FieldIntegrityPolicy } from '@adapters/tools/policies/field-integrity.policy';
import { InMemoryToolCallCounter } from '@adapters/tools/policies/in-memory-tool-call-counter';
import { RequireBusinessContextPolicy } from '@adapters/tools/policies/require-business-context.policy';
import { PostgresToolSecurityLogger } from '@adapters/persistence/postgres-tool-security-logger.adapter';
import { SECURITY_POLICY } from '@config/security-policy';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';
import { IToolSecurityLogger } from '@core/ports/tool-security-logger.port';

export interface SecurityLayer {
  readonly policies: IToolPolicy[];
  readonly securityLogger: IToolSecurityLogger;
}

export function buildSecurityLayer(memory: IMemoryStore, pool: Pool): SecurityLayer {
  const securityLogger = new PostgresToolSecurityLogger(pool);
  const toolCallCounter = new InMemoryToolCallCounter();

  const rateLimitPolicy = new ConversationRateLimitPolicy(
    SECURITY_POLICY.toolRateLimits,
    toolCallCounter,
    10, // Límite por defecto para cualquier herramienta no listada
  );

  const requireBusinessContextPolicy = new RequireBusinessContextPolicy(
    memory,
    {
      minContextMessages: SECURITY_POLICY.minContextMessagesForSensitiveTools,
      targetTools: [
        'send_email',
        'save_lead',
        'schedule_appointment',
        'reschedule_appointment',
        'cancel_appointment',
        'schedule_followup',
      ],
    },
  );

  const fieldIntegrityPolicy = new FieldIntegrityPolicy(memory);

  // Orden: evaluar primero la política en memoria (barata) antes de leer Postgres
  const policies: IToolPolicy[] = [rateLimitPolicy, requireBusinessContextPolicy, fieldIntegrityPolicy];

  return {
    policies,
    securityLogger,
  };
}
