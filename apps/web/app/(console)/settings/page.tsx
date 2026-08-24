import { serverApi } from '@/lib/server-api';
import { SettingsView } from './settings-view';

export default async function SettingsPage() {
  const keys = ((await serverApi.apiKeys()) || []) as Parameters<typeof SettingsView>[0]['initialKeys'];
  return <SettingsView initialKeys={keys} />;
}
