'use client';

import React from 'react';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { Plus, ArrowRight, MessageSquare, Trash2, AlertTriangle, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import { cn } from '@/lib/utils';
import { useConversationsList } from '@/hooks/useConversationsList';
import type { ConversationSummary } from '@/lib/types';

export function ConversationsView({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const {
    conversations,
    loading,
    deletingId,
    deleteTarget,
    setDeleteTarget,
    createConversation,
    confirmDelete,
    closeDeleteDialog,
  } = useConversationsList(initialConversations);

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={MessageSquare}
          title={
            <>
              Conversaciones
              {!loading && conversations.length > 0 && (
                <Badge variant="secondary" className="font-mono">{conversations.length}</Badge>
              )}
            </>
          }
          description="Supervisión e interacción en directo con el Agent Runtime."
          right={
            <Button onClick={createConversation} size="sm" className="gap-1.5 px-2.5 sm:px-3">
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nueva conversación</span>
            </Button>
          }
        />

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
        ) : conversations.length === 0 ? (
          <Card className="text-center p-12 border-dashed">
            <p className="text-muted-foreground">
              No existen conversaciones aún. Haz clic en &quot;Nueva conversación&quot; para probar el runtime.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {conversations.map((conv) => (
              <Link
                key={conv.id}
                href={`/conversations/${conv.id}`}
                transitionTypes={['nav-forward']}
                className="group relative"
              >
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                  <CardContent className="p-5 flex flex-col justify-between h-full min-h-44">
                    <div className="flex items-start justify-between gap-3">
                      <ViewTransition name={`conv-${conv.id}`} share="text-morph" default="none">
                        <span className="font-mono text-sm font-semibold text-foreground">{conv.id}</span>
                      </ViewTransition>
                      <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
                        {conv.role.replace(/_/g, ' ')}
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Actualizada el {new Date(conv.updated_at).toLocaleString('es')}
                      </p>
                      <div className="pt-3 border-t border-border flex items-center justify-between text-sm font-medium">
                        <span className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition">
                          <MessageCircle className="size-4" />
                          Ver conversación
                        </span>
                        <span className="flex items-center gap-1.5">
                          {/* Eliminar en flujo: no tapa nada y no altera el layout */}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget(conv);
                            }}
                            title={`Eliminar ${conv.id}`}
                            className="opacity-0 group-hover:opacity-100 transition p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                          <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition" />
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* Modal de confirmación de eliminación */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) closeDeleteDialog();
          }}
        >
          <AlertDialogPortal>
            <AlertDialogBackdrop />
            <AlertDialogPopup>
              <div className="flex items-center gap-3">
                <span className={cn('size-10 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center shrink-0')}>
                  <AlertTriangle />
                </span>
                <AlertDialogTitle>Eliminar conversación</AlertDialogTitle>
              </div>
              <AlertDialogDescription>
                ¿Eliminar la conversación{' '}
                <span className="font-mono text-foreground bg-muted border border-border rounded px-1.5 py-0.5">
                  {deleteTarget?.id}
                </span>{' '}
                y todo su historial de mensajes? Esta acción no se puede deshacer.
              </AlertDialogDescription>
              <div className="flex justify-end gap-3 pt-2">
                <AlertDialogClose
                  render={
                    <Button variant="outline" disabled={deletingId !== null}>
                      Cancelar
                    </Button>
                  }
                />
                <Button variant="destructive" onClick={confirmDelete} disabled={deletingId !== null}>
                  {deletingId !== null ? (
                    <>
                      <span className="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Eliminando...
                    </>
                  ) : (
                    <>
                      <Trash2 />
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
