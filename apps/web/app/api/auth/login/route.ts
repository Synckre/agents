import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Login server-side: valida la API key contra el backend y, si es válida,
 * establece la cookie de sesión con HttpOnly + Secure (no legible desde JS).
 */
export async function POST(request: NextRequest) {
  let apiKey = '';
  try {
    const body = await request.json();
    apiKey = String(body?.apiKey || '').trim();
  } catch {
    return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: 'Falta la API key.' }, { status: 400 });
  }

  // URL del backend: API_URL (server-side, contenedor api) o fallback a la pública
  const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  try {
    const res = await fetch(`${apiBase}/api/v1/health`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'API Key inválida o no autorizada.' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'No se pudo conectar con el Agent Runtime.' }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('synckre_auth', apiKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return response;
}
