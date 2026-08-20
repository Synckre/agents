'use client';

import React from 'react';
import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-zinc-950">
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center font-extrabold text-zinc-950 shadow-sm text-xl">
            S
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Synckre Control Center</h1>
            <p className="text-xs text-zinc-400">Plataforma de Agentes Autónomos Empresariales</p>
          </div>
        </div>

        <SignIn
          appearance={{
            elements: {
              card: 'bg-zinc-900/80 border border-zinc-800 shadow-2xl rounded-xl',
              headerTitle: 'text-zinc-100 font-bold',
              headerSubtitle: 'text-zinc-400 text-xs',
              socialButtonsBlockButton: 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700',
              formButtonPrimary: 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200 font-semibold text-xs',
              formFieldInput: 'bg-zinc-950 border-zinc-800 text-zinc-100 text-xs',
              footerActionLink: 'text-zinc-300 hover:text-zinc-100',
            },
          }}
          routing="hash"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
