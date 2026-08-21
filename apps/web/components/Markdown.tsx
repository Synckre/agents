'use client';

import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

const components: Components = {
  p: ({ children }) => (
    <p className="leading-relaxed my-1.5 first:mt-0 last:mb-0">{children}</p>
  ),
  h1: ({ children }) => (
    <h1 className="text-base font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => {
    const safe =
      typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : undefined;
    if (!safe) {
      return <span>{children}</span>;
    }
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  pre: ({ children }) => (
    <pre className="bg-muted/60 border border-border rounded-lg p-3 my-2 overflow-x-auto font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    className?.includes('language-') ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="bg-muted border border-border rounded px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),
};

/**
 * Renderiza contenido markdown (GFM) con estilos del tema.
 * Solo la estructura real de markdown (párrafos con línea en blanco y listas
 * con viñetas) genera saltos de línea visibles.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('text-sm text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
