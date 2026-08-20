'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert, Key } from 'lucide-react';

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      // Validar la key server-side: /api/auth/login comprueba contra el backend
      // y establece la cookie de sesión con HttpOnly + Secure.
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      if (response.ok) {
        window.location.href = '/dashboard';
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Acceso denegado: API Key inválida o no autorizada.');
      }
    } catch (err) {
      console.error(err);
      setError('Error de conexión con la API del Agent Runtime.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-4">
      <Card className="border border-zinc-800 bg-zinc-900/60 shadow-xl">
        <CardHeader className="text-center border-b border-zinc-800/80 pb-6 space-y-2">
          <div className="mx-auto w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center font-extrabold text-zinc-950 shadow-sm text-lg">
            S
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-zinc-100 tracking-tight">Synckre Control Center</CardTitle>
            <CardDescription className="text-xs text-zinc-400">Ingresa tu clave de acceso de Synckre Agent</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-6 space-y-4">
          {error && (
            <div className="p-3.5 rounded-lg bg-red-950/30 border border-red-500/20 text-red-400 text-xs flex items-center gap-2 font-mono">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400 font-semibold flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-zinc-500" />
                Access API Key:
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="synckre-int-key-..."
                required
                className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg px-4 py-2.5 text-xs focus:outline-none focus:border-zinc-700 font-mono transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !apiKey.trim()}
              className="w-full py-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-semibold shadow-sm transition disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? 'Autenticando...' : 'Iniciar Sesión'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
