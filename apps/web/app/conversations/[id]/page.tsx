'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ViewTransition } from 'react';
import { api, API_BASE, getApiKey } from '@/lib/api';
import {
  Send,
  Bot,
  User,
  ArrowLeft,
  Terminal,
  Database,
  Clock,
  Trash2,
  Timer,
  ChevronDown,
  AlertTriangle,
  Headset,
  Info,
  X,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectPositioner,
  SelectPopup,
  SelectList,
  SelectItem,
  SelectItemText,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from '@/components/ui/alert-dialog';
import { PageTransition } from '@/components/PageTransition';
import { Markdown } from '@/components/Markdown';
import { ThinkingTimeline } from '@/components/ThinkingTimeline';
import { cn } from '@/lib/utils';

const ROLES = [
  'contact_form_agent',
  'customer_support',
  'sales_assistant',
  'operations_assistant',
  'administrative_assistant',
  'management_assistant',
];

const ROLE_ITEMS = Object.fromEntries(ROLES.map((r) => [r, r]));

interface ToolCall {
  tool: string;
  status?: string;
  result?: unknown;
  task_id?: string;
}

interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  created_at?: string;
  tool_calls?: ToolCall[];
}

interface TelemetryLog {
  id?: string;
  tool_name: string;
  status: string;
  created_at: string;
  execution_time_ms: number;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown> | null;
}

function statusBadge(status: string) {
  switch (status) {
    case 'success':
      return <Badge variant="success" className="text-[10px]">SUCCESS</Badge>;
    case 'requires_human':
    case 'waiting_human':
      return <Badge variant="warning" className="text-[10px]">HUMAN</Badge>;
    case 'temporary_failure':
      return <Badge variant="warning" className="text-[10px]">RETRY</Badge>;
    case 'permanent_failure':
      return <Badge variant="destructive" className="text-[10px]">FAILED</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status.toUpperCase()}</Badge>;
  }
}

function statusTint(status: string) {
  switch (status) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/[0.06] hover:border-emerald-500/60';
    case 'requires_human':
    case 'waiting_human':
      return 'border-amber-500/30 bg-amber-500/[0.06] hover:border-amber-500/60';
    case 'temporary_failure':
      return 'border-amber-500/30 bg-amber-500/[0.06] hover:border-amber-500/60';
    case 'permanent_failure':
      return 'border-rose-500/30 bg-rose-500/[0.06] hover:border-rose-500/60';
    default:
      return 'border-border bg-card hover:border-primary/40';
  }
}

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = params.id as string;

  // ?human=1 -> modo operador humano (atender la conversación escalada)
  const [humanMode, setHumanMode] = useState(searchParams.get('human') === '1');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [role, setRole] = useState('customer_support');
  const [sending, setSending] = useState(false);
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryLog[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);

  // States for simulated stream typing effect
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedToolCalls, setStreamedToolCalls] = useState<ToolCall[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<EventSource | null>(null);

  const closeStream = () => {
    streamRef.current?.close();
    streamRef.current = null;
  };

  // Abre el stream SSE para ver en vivo qué está ejecutando el agente
  const openStream = () => {
    closeStream();
    const es = new EventSource(
      `${API_BASE}/api/v1/conversations/${conversationId}/events?key=${encodeURIComponent(getApiKey())}`
    );
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
            prev.map((t) => (t.tool === e.tool ? { ...t, status: e.status || 'success' } : t))
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

  const handleConfirmDelete = async () => {
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

  const handleSend = async () => {
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
    // Feedback en vivo de la ejecución del agente (SSE)
    openStream();

    try {
      // Modo operador humano: el mensaje se persiste como 'human' sin invocar al agente
      if (humanMode) {
        await api.sendMessage(conversationId, userText, role, true);
        await loadData();
        closeStream();
        return;
      }

      const response = await api.sendMessage(conversationId, userText, role);

      // Si el agente transfirió la conversación (transfer_to_agent), el runtime
      // devuelve el rol nuevo: actualizar el selector para que continúe el nuevo agente.
      if (response?.role && response.role !== role) {
        setRole(String(response.role));
      }

      // Simulate real-time stream response typing effect
      if (response && response.response) {
        const toolCalls = (response.tool_calls || []) as ToolCall[];
        setIsStreaming(true);
        setStreamingText('');
        setStreamedToolCalls(toolCalls);
        const fullText = response.response;
        let currentIdx = 0;

        const interval = setInterval(() => {
          if (currentIdx < fullText.length) {
            // Emite 2 caracteres por tick para un efecto fluido en textos largos
            const step = currentIdx + 2 <= fullText.length ? 2 : 1;
            setStreamingText((prev) => prev + fullText.slice(currentIdx, currentIdx + step));
            currentIdx += step;
          } else {
            clearInterval(interval);
            // Cerrar el stream añadiendo ya la respuesta final (sin re-render de la lista)
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envía; Shift+Enter inserta salto de línea
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <PageTransition>
    <div className="flex flex-col gap-6 min-h-screen lg:h-[calc(100vh-6rem)] lg:min-h-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/conversations"
            transitionTypes={['nav-back']}
            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 transition shrink-0"
            title="Volver a conversaciones"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-zinc-100 flex items-center gap-2 flex-wrap">
              Conversación{' '}
              <ViewTransition name={`conv-${conversationId}`} share="text-morph" default="none">
                <span className="font-mono text-zinc-400 font-bold">{conversationId}</span>
              </ViewTransition>
              <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
                {role.replace(/_/g, ' ')}
              </Badge>
            </h2>
            <p className="text-xs text-zinc-400">Canal de comunicación directo del Agent Runtime.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          {/* Role Selection (shadcn Select) */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-semibold">Rol del Agente:</span>
            <Select value={role} onValueChange={(v) => v && setRole(String(v))} items={ROLE_ITEMS}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectPortal>
                <SelectPositioner>
                  <SelectPopup>
                    <SelectList>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          <SelectItemText>{r}</SelectItemText>
                        </SelectItem>
                      ))}
                    </SelectList>
                  </SelectPopup>
                </SelectPositioner>
              </SelectPortal>
            </Select>
          </div>

          {/* Toggle modo operador humano (IconButton en móvil) */}
          <Button
            variant={humanMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHumanMode((m) => !m)}
            title={humanMode ? 'Volver al modo agente' : 'Atender la conversación como operador humano'}
            aria-label={humanMode ? 'Volver al modo agente' : 'Atender como humano'}
            className={cn("gap-1.5 px-2.5 sm:px-3", humanMode && 'bg-primary text-primary-foreground')}
          >
            <Headset className="size-4 shrink-0" />
            <span className="hidden sm:inline">{humanMode ? 'Modo Operador' : 'Atender como humano'}</span>
          </Button>

          {/* Delete conversation (IconButton) */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDeleteOpen(true)}
            title="Eliminar conversación"
            aria-label="Eliminar conversación"
            className="size-9 rounded-lg border-border text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Banner modo operador humano */}
      {humanMode && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/60 px-4 py-3 animate-fade-slide-in">
          <div className="flex items-center gap-3 text-sm text-foreground">
            <Headset className="size-5 text-muted-foreground shrink-0" />
            <div>
              <p className="font-semibold">Modo operador humano</p>
              <p className="text-xs text-muted-foreground">
                Tus mensajes se envían como operador humano (el agente no interviene). Cuando termines, ciérrala desde la consola de Workflows.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setHumanMode(false)}>
            Salir del modo
          </Button>
        </div>
      )}

      {/* Aviso: mensaje del cliente en cola (atención humana activa) */}
      {queuedNote && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 animate-fade-slide-in">
          <p className="text-sm text-foreground flex items-center gap-2">
            <Info className="size-4 shrink-0" />
            {queuedNote}
          </p>
          <button
            onClick={() => setQueuedNote(null)}
            className="text-muted-foreground hover:text-foreground transition shrink-0"
            title="Descartar aviso"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main Split Grid: Left Chat, Right Inspector (Stacked on Mobile, 2:1 on Desktop) */}
      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 flex-1 overflow-y-auto lg:overflow-hidden">
        {/* Left: Chat Area (2 cols) */}
        <div className="lg:col-span-2 flex flex-col justify-between overflow-hidden pr-2">
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {messages.length === 0 && !isStreaming ? (
              <div className="py-24 text-center text-zinc-500 text-sm">
                Envía un mensaje para comenzar la conversación técnica.
              </div>
            ) : (
              messages.map((msg) => {
                const isAgent = msg.sender === 'agent';
                const isHuman = msg.sender === 'human';
                const isUser = !isAgent && !isHuman;
                return (
                  <div key={msg.id} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-slide-in`}>
                    {!isUser && (
                      <div
                        className={`size-8 rounded-lg border flex items-center justify-center flex-shrink-0 mt-1 ${
                          isAgent
                            ? 'bg-muted border-border text-muted-foreground'
                            : 'bg-secondary border-border text-secondary-foreground'
                        }`}
                      >
                        {isAgent ? <Bot className="size-4" /> : <Headset className="size-4" />}
                      </div>
                    )}

                    <div className="max-w-xl flex flex-col gap-1.5">
                      {/* Etiqueta del emisor */}
                      <div className={`flex items-center gap-1.5 pl-1 ${isUser ? 'justify-end pr-1' : ''}`}>
                        {isAgent && (
                          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <Sparkles className="size-3" />
                            Agente AI
                          </span>
                        )}
                        {isHuman && (
                          <Badge variant="warning" className="text-[10px] uppercase">
                            Operador humano
                          </Badge>
                        )}
                        {isUser && (
                          <span className="text-xs font-medium text-muted-foreground">Cliente</span>
                        )}
                      </div>

                      {/* Timeline de herramientas usadas por el agente */}
                      {isAgent && msg.tool_calls && msg.tool_calls.length > 0 && (
                        <ThinkingTimeline steps={msg.tool_calls} />
                      )}

                      {/* Burbuja: usuario y operador en card; la IA en texto plano (estilo ChatGPT/Claude) */}
                      {isUser ? (
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm font-medium">
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        </div>
                      ) : isHuman ? (
                        <div className="bg-secondary text-secondary-foreground rounded-2xl rounded-tl-sm border border-border px-4 py-2.5">
                          <Markdown>{msg.content}</Markdown>
                        </div>
                      ) : (
                        <div className="text-foreground">
                          <Markdown>{msg.content}</Markdown>
                        </div>
                      )}
                    </div>

                    {isUser && (
                      <div className="size-8 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center flex-shrink-0 mt-1">
                        <User className="size-4" />
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Live Stream Response Bubble (visible también mientras espera al LLM) */}
            {(isStreaming || (sending && !humanMode)) && (
              <div className="flex gap-3 justify-start animate-fade-slide-in">
                <div className="size-8 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="size-4" />
                </div>
                <div className="max-w-xl flex-1 flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 pl-1">
                    <Sparkles className="size-3" />
                    Agente AI
                  </span>

                  {/* Timeline de razonamiento: dots mientras piensa, tools en vivo al llegar */}
                  <ThinkingTimeline steps={streamedToolCalls} streaming />

                  {/* Texto en claro, sin card; caret en línea al final del texto */}
                  <div className="stream-caret text-sm">
                    <Markdown>{streamingText}</Markdown>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Form (composer estilo ChatGPT/Claude) */}
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="pt-4">
            <div className="relative">
              <Textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  humanMode
                    ? 'Responde al cliente como operador humano...'
                    : 'Escribe un mensaje al agente...'
                }
                disabled={sending || (!humanMode && isStreaming)}
                rows={1}
                className="min-h-12 max-h-48 resize-none rounded-2xl bg-muted/40 border-border px-4 py-3 pr-14 text-sm leading-relaxed shadow-sm focus-visible:border-ring"
              />
              <Button
                type="submit"
                size="icon"
                disabled={sending || (!humanMode && isStreaming) || !inputMessage.trim()}
                aria-label="Enviar mensaje"
                className="absolute right-2.5 bottom-1.5 size-9 rounded-full"
              >
                {humanMode ? <Headset /> : <Send />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 px-1">
              Enter para enviar · Shift + Enter para salto de línea
            </p>
          </form>
        </div>

        {/* Right: Technical Telemetry Inspector (1 col) */}
        <Card className="flex flex-col justify-between overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between gap-2 bg-muted/30">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" />
              <span className="font-semibold text-foreground text-sm">Inspector de telemetría</span>
            </div>
            <Badge variant="secondary" className="text-[10px] font-mono">
              {telemetryLogs.length} ejec.
            </Badge>
          </div>
          <CardContent className="p-5 flex-1 overflow-y-auto space-y-3.5">
            {telemetryLogs.length === 0 ? (
              <div className="text-center py-12 text-xs text-zinc-500">
                Esperando eventos técnicos...
                <br />
                <span className="text-zinc-600 mt-1 block">Envía un mensaje que use una tool para ver telemetría.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {telemetryLogs.map((log, idx) => (
                  <details
                    key={log.id || idx}
                    className={`group p-3 rounded-lg font-mono text-xs space-y-1.5 border bg-card text-foreground transition ${statusTint(log.status)}`}
                  >
                    <summary className="flex items-center justify-between cursor-pointer list-none">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ChevronDown className="size-3 text-muted-foreground group-open:rotate-180 transition-transform shrink-0" />
                        <span className="text-foreground font-bold truncate">{log.tool_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {statusBadge(log.status)}
                      </div>
                    </summary>

                    <div className="pt-2 space-y-1.5 border-t border-border mt-1.5">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Timer className="size-3" />
                          {log.execution_time_ms} ms
                        </span>
                      </div>

                      {log.input_data && Object.keys(log.input_data).length > 0 && (
                        <div>
                          <p className="text-muted-foreground font-semibold mb-1">Params:</p>
                          <pre className="bg-muted/40 border border-border rounded p-2 text-xs text-foreground/90 overflow-x-auto max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                            {JSON.stringify(log.input_data, null, 2)}
                          </pre>
                        </div>
                      )}

                      {log.output_data && (
                        <div>
                          <p className="text-muted-foreground font-semibold mb-1">Resultado:</p>
                          <pre className="bg-muted/40 border border-border rounded p-2 text-xs text-foreground/90 overflow-x-auto max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                            {JSON.stringify(log.output_data, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </CardContent>

          <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5">
              <Database className="size-3.5" />
              Telemetría tool_executions
            </span>
            <Badge variant="secondary" className="text-[10px]">Active RAG</Badge>
          </div>
        </Card>
      </div>

      {/* Modal de confirmación de eliminación (shadcn AlertDialog) */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteOpen(false);
        }}
      >
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup>
            <div className="flex items-center gap-3">
              <span className="size-10 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle />
              </span>
              <AlertDialogTitle>Eliminar conversación</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              ¿Eliminar la conversación{' '}
              <span className="font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">
                {conversationId}
              </span>{' '}
              y todo su historial de mensajes? Esta acción no se puede deshacer.
            </AlertDialogDescription>
            <div className="flex justify-end gap-3 pt-2">
              <AlertDialogClose
                render={
                  <Button variant="outline" disabled={deleting}>
                    Cancelar
                  </Button>
                }
              />
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Eliminar
                  </>
                )}
              </Button>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
    </PageTransition>
  );
}
