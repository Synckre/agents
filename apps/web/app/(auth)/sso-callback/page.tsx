'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function SSOCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl="/dashboard"
        signUpForceRedirectUrl="/dashboard"
        signInFallbackRedirectUrl="/login?error=oauth"
        signUpFallbackRedirectUrl="/login?error=oauth"
      />
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200" />
        <p className="text-sm text-zinc-400">Completando autenticación con Google…</p>
      </div>
    </div>
  );
}
