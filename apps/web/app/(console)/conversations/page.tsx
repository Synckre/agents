import { serverApi } from '@/lib/server-api';
import { ConversationsView } from './conversations-view';

export default async function ConversationsPage() {
  const conversations = (await serverApi.conversations()) || [];
  return <ConversationsView initialConversations={conversations} />;
}
