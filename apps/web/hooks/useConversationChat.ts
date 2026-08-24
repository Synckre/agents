'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, getApiBase } from '@/lib/api';
import type { ChatMessage, ToolCall, TelemetryLog } from '@/lib/types';

export const CONVERSATION_ROLES = [
  'contact_form_agent',
  'customer_support',
  'sales_assistant',
  'operations_assistant',
  'administrative_assistant',
  'management_assistant',
];

export const CONVERSATION_ROLE_ITEMS = Object.fromEntries(CONVERSATION_ROLES.map((r) => [r, r]));

export function useConversationChat(conversationId: string, initialHumanMode: boolean) {
  const router = useRouter();
  const [humanMode, setHumanMode] = useState(initialHumanMode);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [role, setRole] = useState('customer_support');
  const [sending, setSending] = useState(false);
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryLog[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedToolCalls, setStreamedToolCalls] = useState<ToolCall[]>([]);
  const [mobileTelemetryOpen, setMobileTelemetryOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<EventSource | null>(null);

  const closeStream = () => {
    streamRef.current?.close();
    streamRef.current = null;
  };

  const openStream = () => {
    closeStream();
    const es = new EventSource(`${getApiBase()}/api/v1/conversations/${conversationId}/events`);
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data);
        if (e.type === 'tool_started') {
          setStreamedToolCalls((prev) => [
            ...prev.filter((t) => t.tool !== e.tool),
            { tool: e.tool, status: 'running' },
          ]);
        } else if (e.type === 'tool_completed') {
          setStreamedToolCalls((prev) =>
            prev.map((t) => (t.tool === e.tool ? { ...t, status: e.status || 'success' } : t)),
          );
        } else if (e.type === 'done') {
          es.close();
        }
      } catch {
        /* evento malformado: ignorar */
      }
    };
    es.onerror = () => es.close();
    streamRef.current = es;
  };

  useEffect(() => () => closeStream(), []);

  const loadData = async () => {
    try {
      const data = await api.getConversation(conversationId);
      setMessages((data.messages as ChatMessage[]) || []);
      if (data.conversation?.role) setRole(data.conversation.role as string);
    } catch (err) {
      console.error('Error cargando detalles:', err);
    }
  };

  const loadTelemetry = async () => {
    try {
      const logs = await api.listToolExecutions(conversationId, 50);
      setTelemetryLogs(logs || []);
    } catch (err) {
      console.error('Error cargando telemetría:', err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (cancelled) return;
      await loadData();
      await loadTelemetry();
    };
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, isStreaming, sending]);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteConversation(conversationId);
      router.push('/conversations');
    } catch (err) {
      console.error(err);
      window.alert('No se pudo eliminar la conversación.');
      setDeleting(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || sending || isStreaming) return;

    const userText = inputMessage;
    setInputMessage('');
    setSending(true);

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      sender: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    openStream();

    try {
      if (humanMode) {
        await api.sendMessage(conversationId, userText, role, true);
        await loadData();
        closeStream();
        return;
      }

      const response = await api.sendMessage(conversationId, userText, role);

      if (response?.role && response.role !== role) {
        setRole(String(response.role));
      }

      if (response && response.response) {
        const toolCalls = (response.tool_calls || []) as ToolCall[];
        setIsStreaming(true);
        setStreamingText('');
        setStreamedToolCalls(toolCalls);
        const fullText = response.response;
        let currentIdx = 0;

        const interval = setInterval(() => {
          if (currentIdx < fullText.length) {
            const step = currentIdx + 2 <= fullText.length ? 2 : 1;
            setStreamingText((prev) => prev + fullText.slice(currentIdx, currentIdx + step));
            currentIdx += step;
          } else {
            clearInterval(interval);
            setMessages((prev) => [
              ...prev,
              {
                id: `stream-${Date.now()}`,
                sender: 'agent',
                content: fullText,
                tool_calls: toolCalls,
                created_at: new Date().toISOString(),
              },
            ]);
            setIsStreaming(false);
            setStreamingText('');
            setStreamedToolCalls([]);
            closeStream();
            loadTelemetry();
          }
        }, 10);
      } else {
        if (response?.status === 'queued' && response?.note) {
          setQueuedNote(response.note);
        }
        closeStream();
        await loadData();
        await loadTelemetry();
      }
    } catch (err) {
      console.error(err);
      await loadData();
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  return {
    humanMode,
    setHumanMode,
    messages,
    inputMessage,
    setInputMessage,
    role,
    setRole,
    sending,
    telemetryLogs,
    deleting,
    deleteOpen,
    setDeleteOpen,
    queuedNote,
    setQueuedNote,
    streamingText,
    isStreaming,
    streamedToolCalls,
    mobileTelemetryOpen,
    setMobileTelemetryOpen,
    messagesEndRef,
    confirmDelete,
    sendMessage,
    handleComposerKeyDown,
  };
}
