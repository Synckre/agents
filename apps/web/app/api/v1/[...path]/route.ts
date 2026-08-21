/**
 * Proxy same-origin hacia el Agent Runtime.
 * El navegador llama a /api/v1/* en control-ai.synckre.com; Next reenvía a API_URL.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function backendBase(): string {
  return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(
    /\/$/,
    '',
  );
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = backendBase();
  const dest = `${base}/api/v1/${path.join('/')}${req.nextUrl.search}`;

  let destUrl: URL;
  try {
    destUrl = new URL(dest);
  } catch {
    return NextResponse.json({ detail: 'API_URL inválida.' }, { status: 500 });
  }

  if (destUrl.origin === req.nextUrl.origin) {
    return NextResponse.json(
      {
        detail:
          'API_URL apunta al propio frontend. Configura API_URL hacia el backend FastAPI (p. ej. https://agent.synckre.com).',
      },
      { status: 500 },
    );
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  try {
    const res = await fetch(dest, {
      method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    });

    const outHeaders = new Headers();
    res.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        outHeaders.set(key, value);
      }
    });

    return new NextResponse(res.body, { status: res.status, headers: outHeaders });
  } catch {
    return NextResponse.json(
      { detail: 'No se pudo conectar con el Agent Runtime.', status: 'offline' },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
