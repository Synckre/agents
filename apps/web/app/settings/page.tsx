'use client';

import React from 'react';
import { Settings, Cpu, Database, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';

export default function SettingsPage() {
  return (
    <PageTransition>
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Settings}
        title="Configuración del Sistema"
        description="Parámetros globales del Agent Runtime V2 e integraciones."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 border-b border-border pb-4">
            <span className="chip-icon">
              <Cpu />
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

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 border-b border-border pb-4">
            <span className="chip-icon">
              <Database />
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
    </div>
    </PageTransition>
  );
}
