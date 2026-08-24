'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import type { ApiKeyItem } from '@/lib/types';

export function useApiKeys(initialKeys: ApiKeyItem[]) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>(initialKeys);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadKeys = async () => {
    try {
      setLoadingKeys(true);
      const data = await api.listApiKeys();
      setApiKeys(data || []);
    } catch (err: unknown) {
      console.error(err);
      setErrorMsg(errorMessage(err, 'Error al cargar API keys'));
    } finally {
      setLoadingKeys(false);
    }
  };

  const createKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || creating) return;

    try {
      setCreating(true);
      setErrorMsg(null);
      const res = await api.createApiKey(newKeyName.trim());
      if (res?.raw_key) {
        setCreatedRawKey(res.raw_key);
      }
      setNewKeyName('');
      await loadKeys();
    } catch (err: unknown) {
      console.error(err);
      setErrorMsg(errorMessage(err, 'Error al generar la API key'));
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    try {
      await api.revokeApiKey(id);
      await loadKeys();
    } catch (err: unknown) {
      console.error(err);
      setErrorMsg(errorMessage(err, 'Error al revocar la API key'));
    }
  };

  const copyCreatedKey = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return {
    apiKeys,
    loadingKeys,
    newKeyName,
    setNewKeyName,
    creating,
    createdRawKey,
    copied,
    errorMsg,
    createKey,
    revokeKey,
    copyCreatedKey,
  };
}
