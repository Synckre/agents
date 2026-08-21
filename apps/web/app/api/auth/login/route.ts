import { NextResponse } from 'next/server';

/**
 * Login legado por API key: desactivado.
 * El Control Center autentica con Clerk.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Usa el inicio de sesión de Clerk. Ya no se requiere API key.' },
    { status: 410 },
  );
}
