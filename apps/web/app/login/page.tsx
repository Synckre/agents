'use client';

import React, { useState } from 'react';
import { useSignIn } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Mail, Lock, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleGoogleAuth = async () => {
    if (!isSignInLoaded) return;
    try {
      setLoading(true);
      setError('');
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/dashboard',
      });
    } catch (err: unknown) {
      console.error(err);
      setError('Error al conectar con Google OAuth.');
      setLoading(false);
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignInLoaded || loading) return;

    setLoading(true);
    setError('');

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete') {
        await setSignInActive({ session: result.createdSessionId });
        router.push('/dashboard');
      } else {
        setError('No se pudo completar el inicio de sesión. Revisa tus credenciales.');
      }
    } catch (err: unknown) {
      console.error(err);
      const clerkErr = err as { errors?: { longMessage?: string; message?: string }[] };
      const msg =
        clerkErr?.errors?.[0]?.longMessage ||
        clerkErr?.errors?.[0]?.message ||
        'Error de autenticación. Verifica tu correo y contraseña.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-zinc-950 font-sans">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="size-14 rounded-2xl bg-zinc-100 text-zinc-950 flex items-center justify-center font-bold text-2xl shadow-xl border border-zinc-200">
            S
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-100 tracking-tight flex items-center justify-center gap-2">
              Synckre Agent
              <Badge variant="outline" className="font-mono text-[11px] uppercase border-zinc-700 text-zinc-400 px-2 py-0.5">
                Enterprise
              </Badge>
            </h1>
            <p className="text-sm text-zinc-400">Control Center · Acceso restringido</p>
          </div>
        </div>

        <Card className="border border-zinc-800 bg-zinc-900/90 shadow-2xl backdrop-blur-md">
          <CardContent className="p-6 space-y-5 pt-6">
            {error && (
              <div className="p-4 rounded-xl bg-red-950/50 border border-red-500/30 text-red-400 text-sm flex items-start gap-3">
                <ShieldAlert className="size-5 text-red-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <form onSubmit={handleSignInSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                  <Mail className="size-4 text-zinc-400" />
                  Correo Electrónico
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@synckre.com"
                  required
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-500 text-sm h-11 focus:border-zinc-700"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                  <Lock className="size-4 text-zinc-400" />
                  Contraseña
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-500 text-sm h-11 focus:border-zinc-700"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !email.trim() || !password}
                className="w-full h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-sm font-semibold shadow-md gap-2 transition"
              >
                {loading ? 'Autenticando...' : <>Ingresar al Panel <ArrowRight className="size-4" /></>}
              </Button>
            </form>

            <div className="relative flex items-center justify-center my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-zinc-900 px-3 text-zinc-500 font-mono tracking-wider">
                  o ingresa con Google
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full h-11 bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-200 text-sm font-medium gap-3 transition"
            >
              <svg className="size-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.27v3.15C3.25 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.27C.46 8.2.005 10.04.005 12s.455 3.8 1.265 5.42l4.01-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.23 0 12 0 7.31 0 3.25 2.7 1.27 6.58l4.01 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              Continuar con Google
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
