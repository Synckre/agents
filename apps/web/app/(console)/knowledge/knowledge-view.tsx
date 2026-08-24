'use client';

import React from 'react';
import { BookOpen, Upload, FileText, FileUp, CheckCircle2, X, Loader2, Layers } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';
import { KNOWLEDGE_DOMAINS, useKnowledgeSources } from '@/hooks/useKnowledgeSources';
import type { KnowledgeSource } from '@/lib/types';

export function KnowledgeView({ initialSources }: { initialSources: KnowledgeSource[] }) {
  const {
    sources,
    loading,
    title,
    setTitle,
    domain,
    setDomain,
    content,
    setContent,
    ingesting,
    pdfFile,
    pdfTitle,
    setPdfTitle,
    pdfDomain,
    setPdfDomain,
    uploading,
    uploadMsg,
    fileInputRef,
    ingestText,
    selectPdf,
    uploadPdf,
  } = useKnowledgeSources(initialSources);

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={BookOpen}
          title="Conocimiento RAG"
          description="Base de conocimiento vectorial aislada por dominio."
          right={
            sources.length > 0 ? (
              <Badge variant="secondary" className="font-mono">
                {sources.length} fuentes
              </Badge>
            ) : undefined
          }
        />

        {/* Ingesta */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* PDF */}
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <span className="chip-icon">
                  <FileUp />
                </span>
                <CardTitle>Subir PDF</CardTitle>
              </div>
              <CardDescription>
                El texto se extrae automáticamente y se vectoriza por chunks.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 flex flex-col gap-4">
              <form onSubmit={uploadPdf} className="flex flex-col gap-4">
                <label
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition text-center ${
                    pdfFile
                      ? 'border-primary/50 bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={selectPdf}
                    className="hidden"
                  />
                  {pdfFile ? (
                    <>
                      <FileText className="size-8" />
                      <span className="text-sm font-medium break-all max-w-full">{pdfFile.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {(pdfFile.size / 1024).toFixed(1)} KB
                      </span>
                    </>
                  ) : (
                    <>
                      <FileUp className="size-8" />
                      <span className="text-sm font-medium">Selecciona o arrastra un PDF</span>
                      <span className="text-xs text-muted-foreground">Máx. 25 MB</span>
                    </>
                  )}
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">Título (opcional)</label>
                    <Input
                      value={pdfTitle}
                      onChange={(e) => setPdfTitle(e.target.value)}
                      placeholder="ej: Manual de servidores"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">Dominio</label>
                    <select
                      value={pdfDomain}
                      onChange={(e) => setPdfDomain(e.target.value)}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {KNOWLEDGE_DOMAINS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {uploadMsg && (
                  <div
                    className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
                      uploadMsg.ok
                        ? 'text-foreground border-border bg-muted/40'
                        : 'text-destructive border-destructive/30 bg-destructive/10'
                    }`}
                  >
                    {uploadMsg.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <X className="size-4 shrink-0" />}
                    <span>{uploadMsg.text}</span>
                  </div>
                )}

                <Button type="submit" disabled={uploading || !pdfFile} className="w-full">
                  {uploading ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Vectorizando PDF...
                    </>
                  ) : (
                    <>
                      <Upload />
                      Subir y vectorizar
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Texto */}
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <span className="chip-icon">
                  <FileText />
                </span>
                <CardTitle>Ingerir texto</CardTitle>
              </div>
              <CardDescription>Pega el contenido de un documento para vectorizarlo.</CardDescription>
            </CardHeader>
            <CardContent className="p-5">
              <form onSubmit={ingestText} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">Título</label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="ej: Alcance proyecto 2026"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">Dominio</label>
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {KNOWLEDGE_DOMAINS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground">Contenido</label>
                  <Textarea
                    rows={6}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Pega aquí el contenido a vectorizar..."
                    className="font-mono"
                    required
                  />
                </div>

                <Button type="submit" disabled={ingesting || !title || !content} className="w-full">
                  {ingesting ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Vectorizando...
                    </>
                  ) : (
                    <>
                      <Upload />
                      Ingerir y vectorizar
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Fuentes */}
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" />
            Fuentes indexadas
          </h3>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
          ) : sources.length === 0 ? (
            <Card className="text-center p-12 border-dashed">
              <p className="text-muted-foreground">Sin documentos indexados todavía.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sources.map((src) => (
                <Card key={src.id} className="p-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold text-foreground truncate flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground shrink-0" />
                      {src.title}
                    </h4>
                    <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                      {src.source_type}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`size-1.5 rounded-full ${
                          src.status === 'indexed' ? 'bg-primary' : 'bg-muted-foreground'
                        }`}
                      />
                      {src.domain} · {src.chunk_count || 1} chunks
                    </span>
                    <span>{new Date(src.created_at).toLocaleDateString('es')}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
