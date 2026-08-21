import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness para Coolify/Traefik: no pasa por Clerk. */
export function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
