'use client';

import React, { useState } from 'react';
import { useSignIn } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Mail, Lock, ArrowRight, Sparkles, KeyRound } from 'lucide-react';

export default function LoginPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = Router();

  function Router() {
    try {
      return useRouter();
    } catch {
      return null;
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading) return;

    setLoading(true);
    setError('');

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        if (router) {
          router.push('/dashboard');
        } else {
          window.location.href = '/dashboard';
        }
      } else {
        setError('No se pudo completar el inicio de sesión. Revisa tus credenciales.');
      }
    } catch (err: any) {
      console.error(err);
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || 'Error de autenticación. Verifica tu correo y contraseña.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-zinc-950 font-sans">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Logo & Title */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="size-12 rounded-xl bg-zinc-100 text-zinc-950 flex items-center justify-center font-bold text-2xl shadow-xl border border-zinc-200">
            S
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100 tracking-tight flex items-center justify-center gap-2">
              Synckre Agent
              <Badge variant="outline" className="font-mono text-[10px] uppercase border-zinc-700 text-zinc-400">
                Enterprise
              </Badge>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">Control Center · Plataforma de Agentes Autónomos</p>
          </div>
        </div>

        {/* shadcn Card Container */}
        <Card className="border border-zinc-800 bg-zinc-900/90 shadow-2xl backdrop-blur-md">
          <CardHeader className="text-center border-b border-zinc-800/80 pb-5 space-y-1.5">
            <CardTitle className="text-lg font-semibold text-zinc-100">Iniciar Sesión</CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Ingresa tus credenciales corporativas para acceder
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {error && (
              <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5 font-mono">
                <ShieldAlert className="size-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Mail className="size-3.5 text-zinc-400" />
                  Correo Electrónico
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@synckre.com"
                  required
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-600 text-xs h-10 focus:border-zinc-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Lock className="size-3.5 text-zinc-400" />
                  Contraseña
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-600 text-xs h-10 focus:border-zinc-700"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !email.trim() || !password}
                className="w-full h-10 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-semibold shadow-md gap-2 transition"
              >
                {loading ? (
                  'Autenticando...'
                ) : (
                  <>
                    Ingresar al Panel
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Footer info */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-500 font-mono">
          <KeyRound className="size-3.5 text-zinc-600" />
          <span>Autenticación Segura con Clerk Auth</span>
        </div>
      </div>
    </div>
  );
}
