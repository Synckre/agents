import { serverApi } from '@/lib/server-api';
import { KnowledgeView } from './knowledge-view';

export default async function KnowledgePage() {
  const sources = ((await serverApi.knowledge()) || []) as Parameters<typeof KnowledgeView>[0]['initialSources'];
  return <KnowledgeView initialSources={sources} />;
}
