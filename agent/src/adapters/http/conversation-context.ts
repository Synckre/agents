import { AsyncLocalStorage } from 'node:async_hooks';

const conversationIdStore = new AsyncLocalStorage<string>();

export function runWithConversationId<T>(conversationId: string, fn: () => T): T {
  return conversationIdStore.run(conversationId, fn);
}

export function getRequestConversationId(): string | undefined {
  return conversationIdStore.getStore();
}
