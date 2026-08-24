'use client';

import React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ViewTransition } from 'react';
import {
  Send,
  Bot,
  User,
  ArrowLeft,
  Terminal,
  Database,
  Trash2,
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
import { TelemetryLogList } from '@/components/conversation/TelemetryLogList';
import { cn } from '@/lib/utils';
import {
  CONVERSATION_ROLE_ITEMS,
  CONVERSATION_ROLES,
  useConversationChat,
} from '@/hooks/useConversationChat';

export default function ConversationDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const conversationId = params.id as string;
  const {
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
  } = useConversationChat(conversationId, searchParams.get('human') === '1');

  return (
    <PageTransition>
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)] overflow-hidden">
      {/* Header (Buttons always on right) */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/conversations"
            transitionTypes={['nav-back']}
            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 transition shrink-0"
            title="Volver a conversaciones"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-bold text-zinc-100 flex items-center gap-2 flex-wrap">
              <span className="truncate">Conversación</span>{' '}
              <ViewTransition name={`conv-${conversationId}`} share="text-morph" default="none">
                <span className="font-mono text-zinc-400 font-bold truncate">{conversationId}</span>
              </ViewTransition>
              <Badge variant="secondary" className="text-[10px] uppercase shrink-0 hidden sm:inline-flex">
                {role.replace(/_/g, ' ')}
              </Badge>
            </h2>
            <p className="text-xs text-zinc-400 truncate hidden sm:block">Canal de comunicación directo del Agent Runtime.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Mobile Telemetry Inspector Modal Trigger */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileTelemetryOpen(true)}
            title="Ver telemetría técnica"
            className="lg:hidden gap-1.5 px-2 text-xs"
          >
            <Terminal className="size-3.5 text-muted-foreground" />
            <span>{telemetryLogs.length} ejec.</span>
          </Button>

          {/* Role Selection (shadcn Select) */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-semibold">Rol del Agente:</span>
            <Select value={role} onValueChange={(v) => v && setRole(String(v))} items={CONVERSATION_ROLE_ITEMS}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectPortal>
                <SelectPositioner>
                  <SelectPopup>
                    <SelectList>
                      {CONVERSATION_ROLES.map((r) => (
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
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/60 px-4 py-3 shrink-0 animate-fade-slide-in">
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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 shrink-0 animate-fade-slide-in">
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

      {/* Main Split Grid: Left Chat (Full height with normal scroll), Right Inspector (Desktop inline, Mobile modal) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden min-h-0">
        {/* Left: Chat Area (2 cols on desktop, 1 col full height on mobile) */}
        <div className="lg:col-span-2 flex flex-col justify-between overflow-hidden h-full">
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

                    <div className="max-w-[85%] sm:max-w-xl flex flex-col gap-1.5 min-w-0">
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
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3.5 py-2.5 shadow-sm font-medium">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
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
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="pt-4">
            <div className="relative">
              <Textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleComposerKeyDown}
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

        {/* Right: Technical Telemetry Inspector (Desktop inline 1-col, hidden on mobile) */}
        <Card className="hidden lg:flex flex-col justify-between overflow-hidden">
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
            <TelemetryLogList logs={telemetryLogs} />
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

      {/* Modal / Sheet de Telemetría para Dispositivos Móviles */}
      {mobileTelemetryOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex justify-end">
          <div
            onClick={() => setMobileTelemetryOpen(false)}
            className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm animate-fade-slide-in"
          />
          <div className="relative w-full max-w-lg bg-background h-full border-l border-border p-5 flex flex-col justify-between z-10 shadow-2xl animate-fade-slide-in">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Terminal className="size-5 text-muted-foreground" />
                <span className="font-bold text-foreground text-base">Inspector de telemetría</span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setMobileTelemetryOpen(false)}
                className="size-8"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3.5">
              <TelemetryLogList logs={telemetryLogs} />
            </div>

            <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span className="flex items-center gap-1.5">
                <Database className="size-3.5" />
                Telemetría tool_executions
              </span>
              <Badge variant="secondary" className="text-[10px]">{telemetryLogs.length} ejec.</Badge>
            </div>
          </div>
        </div>
      )}

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
                onClick={confirmDelete}
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
