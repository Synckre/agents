import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildSecurityLayer } from '../src/bootstrap/build-security-layer';
import { ConversationRateLimitPolicy } from '@adapters/tools/policies/conversation-rate-limit.policy';
import { FieldIntegrityPolicy } from '@adapters/tools/policies/field-integrity.policy';
import { RequireBusinessContextPolicy } from '@adapters/tools/policies/require-business-context.policy';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';

describe('Bootstrap Builders', () => {
  describe('buildSecurityLayer', () => {
    it('construye las políticas con ConversationRateLimitPolicy primero y RequireBusinessContextPolicy después', () => {
      const memory = new InMemoryStore();
      const dummyPool = {} as Pool;

      const security = buildSecurityLayer(memory, dummyPool);

      expect(security.policies).toHaveLength(3);
      expect(security.policies[0]).toBeInstanceOf(ConversationRateLimitPolicy);
      expect(security.policies[1]).toBeInstanceOf(RequireBusinessContextPolicy);
      expect(security.policies[2]).toBeInstanceOf(FieldIntegrityPolicy);
      expect(security.securityLogger).toBeDefined();
    });
  });
});
