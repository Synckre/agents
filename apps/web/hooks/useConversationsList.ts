'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { ConversationSummary } from '@/lib/types';

export function useConversationsList(initialConversations: ConversationSummary[]) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [loading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);

  const roles = useMemo(() => {
    const set = new Set<string>();
    conversations.forEach((c) => {
      if (c.role) set.add(c.role);
    });
    return Array.from(set).sort();
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return conversations.filter((conv) => {
      const matchesQuery =
        !query ||
        conv.id.toLowerCase().includes(query) ||
        conv.role.toLowerCase().includes(query);
      const matchesRole = roleFilter === 'all' || conv.role === roleFilter;
      return matchesQuery && matchesRole;
    });
  }, [conversations, searchQuery, roleFilter]);

  const clearFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
  };

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
    filteredConversations,
    loading,
    searchQuery,
    setSearchQuery,
    roleFilter,
    setRoleFilter,
    roles,
    clearFilters,
    deletingId,
    deleteTarget,
    setDeleteTarget,
    createConversation,
    confirmDelete,
    closeDeleteDialog,
  };
}

