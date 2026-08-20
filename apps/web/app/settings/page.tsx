'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Cpu, Database, Sparkles, Key, Plus, Trash2, Copy, Check, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import { api } from '@/lib/api';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  role: string;
  is_active: boolean;
  created_at: string;
  raw_key?: string;
}

export default function SettingsPage() {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
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
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Error al cargar API keys');
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || creating) return;

    try {
      setCreating(true);
      setErrorMsg(null);
      const res = await api.createApiKey(newKeyName.trim(), 'public');
      if (res?.raw_key) {
        setCreatedRawKey(res.raw_key);
      }
      setNewKeyName('');
      await loadKeys();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Error al generar la API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await api.revokeApiKey(id);
      await loadKeys();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Error al revocar la API key');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Settings}
          title="Configuración del Sistema"
          description="Parámetros globales del Agent Runtime V2, gestión de API Keys e integraciones."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border border-border">
            <CardHeader className="flex flex-row items-center gap-2 border-b border-border pb-4">
              <span className="chip-icon">
                <Cpu className="size-4" />
              </span>
              <div>
                <CardTitle>Configuración de Modelo LLM</CardTitle>
                <CardDescription>Detalles del motor conversacional del runtime.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-6 flex flex-col gap-2.5 text-sm text-muted-foreground font-mono">
              <div className="flex justify-between py-1.5 border-b border-border">
                <span>Proveedor LLM:</span>
                <Badge variant="secondary" className="font-mono">DeepSeek</Badge>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span>Modelo Activo:</span>
                <span className="text-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3 text-muted-foreground" />
                  deepseek-v4-flash
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span>Límite Iteraciones:</span>
                <span className="text-foreground">5 max_iterations</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border">
            <CardHeader className="flex flex-row items-center gap-2 border-b border-border pb-4">
              <span className="chip-icon">
                <Database className="size-4" />
              </span>
              <div>
                <CardTitle>Motor RAG & Base de Datos</CardTitle>
                <CardDescription>Esquemas de persistencia y búsqueda vectorial.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-6 flex flex-col gap-2.5 text-sm text-muted-foreground font-mono">
              <div className="flex justify-between py-1.5 border-b border-border">
                <span>Base de Datos:</span>
                <Badge variant="secondary" className="font-mono">PostgreSQL 16 + pgvector</Badge>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span>Modelo Embeddings:</span>
                <span className="text-foreground">Ollama qwen3-embedding:0.6b</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span>Dimensiones Vectoriales:</span>
                <span className="text-foreground">1024 dims</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sección de Gestión de API Keys */}
        <Card className="border border-border">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-2">
              <span className="chip-icon">
                <Key className="size-4" />
              </span>
              <div>
                <CardTitle>Gestión de API Keys</CardTitle>
                <CardDescription>Crea y administra claves de acceso para conectar aplicaciones externas.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {errorMsg && (
              <div className="p-3.5 rounded-lg bg-red-950/30 border border-red-500/20 text-red-400 text-xs flex items-center gap-2 font-mono">
                <ShieldAlert className="size-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Modal / Alerta de Nueva Key Generada */}
            {createdRawKey && (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 space-y-2 font-mono">
                <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold">
                  <span>¡API Key Generada con Éxito!</span>
                  <span className="text-[10px] text-emerald-500/80">Cópiala ahora (solo se mostrará una vez)</span>
                </div>
                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg text-xs">
                  <input
                    type="text"
                    readOnly
                    value={createdRawKey}
                    className="bg-transparent flex-1 text-zinc-100 focus:outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(createdRawKey)}
                    className="h-8 gap-1.5 text-xs border-zinc-700 hover:bg-zinc-800"
                  >
                    {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    {copied ? 'Copiada' : 'Copiar'}
                  </Button>
                </div>
              </div>
            )}

            {/* Formulario para Generar Nueva API Key Dinámica */}
            <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Nombre de la integración (ej. Widget Web, CRM Externa, Bot WhatsApp)"
                className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 rounded-lg px-4 py-2 text-xs focus:outline-none focus:border-zinc-700"
                required
              />
              <Button type="submit" disabled={creating || !newKeyName.trim()} className="gap-1.5 text-xs font-semibold shrink-0">
                <Plus className="size-4" />
                {creating ? 'Generando...' : 'Generar API Key Dinámica'}
              </Button>
            </form>

            {/* Tabla de API Keys */}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-900/60 border-b border-border text-muted-foreground">
                  <tr>
                    <th className="p-3">Nombre de Integración</th>
                    <th className="p-3">Prefijo Key</th>
                    <th className="p-3">Tipo de Auth</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingKeys ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">Cargando API keys...</td>
                    </tr>
                  ) : apiKeys.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">No hay API keys de integración generadas.</td>
                    </tr>
                  ) : (
                    apiKeys.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-900/30 transition">
                        <td className="p-3 text-foreground font-semibold font-sans">{item.name}</td>
                        <td className="p-3 text-muted-foreground">{item.prefix}...</td>
                        <td className="p-3">
                          <Badge variant="outline" className="font-mono text-[10px] text-zinc-300 border-zinc-700">
                            x-api-key dinámica
                          </Badge>
                        </td>
                        <td className="p-3">
                          {item.is_active ? (
                            <span className="text-emerald-400 flex items-center gap-1 font-sans text-[11px]">● Activa</span>
                          ) : (
                            <span className="text-red-400/80 flex items-center gap-1 font-sans text-[11px]">● Revocada</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {item.is_active && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRevokeKey(item.id)}
                              className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/20 gap-1"
                            >
                              <Trash2 className="size-3.5" />
                              Revocar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}
