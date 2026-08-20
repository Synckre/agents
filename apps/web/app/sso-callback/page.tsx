'use client';

import { useEffect } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

export default function SSOCallbackPage() {
  const { handleRedirectCallback } = useClerk();
  const router = useRouter();

  useEffect(() => {
    handleRedirectCallback()
      .then(() => {
        router.push('/dashboard');
      })
      .catch((err) => {
        console.error('Error en SSO callback:', err);
        router.push('/login?error=oauth');
      });
  }, [handleRedirectCallback, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200" />
        <p className="text-sm text-zinc-400">Completando autenticación con Google…</p>
      </div>
    </div>
  );
}
