'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { ConversationSummary } from '@/lib/types';

export function useConversationsList(initialConversations: ConversationSummary[]) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [loading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);

  const createConversation = async () => {
    try {
      const conv = await api.createConversation();
      router.push(`/conversations/${conv.id}`);
    } catch (err) {
      console.error(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deletingId) return;
    setDeletingId(deleteTarget.id);
    try {
      await api.deleteConversation(deleteTarget.id);
      setConversations((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      window.alert('No se pudo eliminar la conversación.');
    } finally {
      setDeletingId(null);
    }
  };

  const closeDeleteDialog = () => {
    if (!deletingId) setDeleteTarget(null);
  };

  return {
    conversations,
    loading,
    deletingId,
    deleteTarget,
    setDeleteTarget,
    createConversation,
    confirmDelete,
    closeDeleteDialog,
  };
}
