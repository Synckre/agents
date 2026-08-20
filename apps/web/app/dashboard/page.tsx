'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import {
  MessageSquare,
  Activity,
  RefreshCw,
  Clock,
  Terminal,
  Database,
  Calendar,
  Mail,
  ChevronRight,
  TrendingUp,
  Wrench,
  BookOpen,
  Bot,
} from 'lucide-react';

interface Conversation {
  id: string;
  role: string;
  updated_at: string;
}

interface AuditLog {
  id: string | number;
  action: string;
  agent_role: string;
  tool_name?: string | null;
  timestamp: string;
  input_summary?: string | null;
  output_summary?: string | null;
  authorization_result: string;
}

const STATS = [
  {
    key: 'erp_mutations' as const,
    label: 'Mutaciones ERP',
    hint: 'Registros en Postgres',
    icon: Database,
  },
  {
    key: 'calendar_bookings' as const,
    label: 'Reuniones agendadas',
    hint: 'Calendario',
    icon: Calendar,
  },
  {
    key: 'emails_sent' as const,
    label: 'Correos enviados',
    hint: 'Mensajes vía proveedor',
    icon: Mail,
  },
  {
    key: 'rag_queries' as const,
    label: 'Consultas RAG',
    hint: 'Búsquedas vectoriales',
    icon: BookOpen,
  },
];

function actionMeta(action: string, toolName?: string | null) {
  if (action === 'tool_execution' || toolName) {
    return { label: toolName || 'Tool', icon: Wrench };
  }
  if (action === 'agent_execution') {
    return { label: 'Agente', icon: Bot };
  }
  return { label: action, icon: Activity };
}

export default function DashboardPage() {
  const [stats, setStats] = useState({
    erp_mutations: 0,
    calendar_bookings: 0,
    emails_sent: 0,
    rag_queries: 0,
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, convsData, auditData] = await Promise.allSettled([
        api.getAnalyticsStats(),
        api.listConversations(),
        api.listAuditLogs(),
      ]);

      if (statsData.status === 'fulfilled') setStats(statsData.value);
      if (convsData.status === 'fulfilled') setConversations(convsData.value);
      if (auditData.status === 'fulfilled') setAuditLogs(auditData.value);
    } catch (err) {
      console.error('Error cargando telemetría del dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (cancelled) return;
      await loadData();
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Activity}
          title="Monitoreo y Telemetría"
          description="Seguimiento en tiempo real de integraciones y acciones del Agent Runtime."
          right={
            <button onClick={loadData} disabled={loading} className="btn-ghost">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              <span>Actualizar</span>
            </button>
          }
        />

        {/* Métricas */}
        {loading ? (
          <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4 pb-2 sm:pb-0 scrollbar-none">
            <Skeleton className="w-[82vw] max-w-[280px] shrink-0 snap-center sm:w-auto h-28 rounded-2xl" />
            <Skeleton className="w-[82vw] max-w-[280px] shrink-0 snap-center sm:w-auto h-28 rounded-2xl" />
            <Skeleton className="w-[82vw] max-w-[280px] shrink-0 snap-center sm:w-auto h-28 rounded-2xl" />
            <Skeleton className="w-[82vw] max-w-[280px] shrink-0 snap-center sm:w-auto h-28 rounded-2xl" />
          </div>
        ) : (
          <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4 pb-2 sm:pb-0 scrollbar-none">
            {STATS.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.key} className="w-[82vw] max-w-[280px] shrink-0 snap-center sm:w-auto">
                  <CardContent className="p-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {stat.label}
                      </span>
                      <div className="text-3xl font-bold text-foreground">{stats[stat.key]}</div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="size-3.5" />
                        {stat.hint}
                      </p>
                    </div>
                    <div className="size-10 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center">
                      <Icon />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Actividad del agente */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center gap-2 border-b border-border pb-4">
              <Terminal className="size-4 text-muted-foreground" />
              <div>
                <CardTitle>Actividad del agente</CardTitle>
                <CardDescription>Últimos eventos de ejecución y herramientas.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {loading ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  Sin actividad del agente registrada todavía.
                </div>
              ) : (
                <ol className="flex flex-col divide-y divide-border">
                  {auditLogs.slice(0, 12).map((log) => {
                    const meta = actionMeta(log.action, log.tool_name);
                    const Icon = meta.icon;
                    return (
                      <li key={log.id} className="py-3.5 first:pt-0 last:pb-0">
                        <div className="flex items-start gap-3">
                          <div className="size-8 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="size-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <p className="text-sm font-medium text-foreground">
                                {meta.label}
                                <span className="text-muted-foreground font-normal">
                                  {' '}
                                  · {log.agent_role.replace(/_/g, ' ')}
                                </span>
                              </p>
                              <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                                <Clock className="size-3" />
                                {new Date(log.timestamp).toLocaleTimeString('es')}
                              </span>
                            </div>
                            {log.input_summary && (
                              <p className="text-sm text-muted-foreground truncate mt-0.5">
                                {log.input_summary}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={
                              log.authorization_result === 'authorized'
                                ? 'secondary'
                                : log.authorization_result === 'denied'
                                ? 'destructive'
                                : 'outline'
                            }
                            className="text-[10px] shrink-0"
                          >
                            {log.authorization_result === 'authorized'
                              ? 'OK'
                              : log.authorization_result.toUpperCase()}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Conversaciones recientes */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 border-b border-border pb-4">
              <MessageSquare className="size-4 text-muted-foreground" />
              <div>
                <CardTitle>Conversaciones recientes</CardTitle>
                <CardDescription>Sesiones activas en el runtime.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {loading ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">Sin conversaciones registradas.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {conversations.slice(0, 6).map((conv) => (
                    <Link
                      key={conv.id}
                      href={`/conversations/${conv.id}`}
                      transitionTypes={['nav-forward']}
                      className="group flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/40 border border-border hover:border-primary/40 transition"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium text-foreground truncate">{conv.id}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {conv.role.replace(/_/g, ' ')} · {new Date(conv.updated_at).toLocaleTimeString('es')}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}
