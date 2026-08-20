'use client';

import React, { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Mail, Lock, ArrowRight, User, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [code, setCode] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // 1-Click Google OAuth
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
    } catch (err: any) {
      console.error(err);
      setError('Error al conectar con Google OAuth.');
      setLoading(false);
    }
  };

  // Handle Sign In Submission
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
    } catch (err: any) {
      console.error(err);
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || 'Error de autenticación. Verifica tu correo y contraseña.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Sign Up Submission
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignUpLoaded || loading) return;

    setLoading(true);
    setError('');

    try {
      if (!verifyingCode) {
        await signUp.create({
          emailAddress: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });

        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setVerifyingCode(true);
      } else {
        const completeSignUp = await signUp.attemptEmailAddressVerification({
          code: code.trim(),
        });

        if (completeSignUp.status === 'complete') {
          await setSignUpActive({ session: completeSignUp.createdSessionId });
          router.push('/dashboard');
        } else {
          setError('Código de verificación incorrecto.');
        }
      }
    } catch (err: any) {
      console.error(err);
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || 'Error al crear la cuenta. Revisa los datos ingresados.';
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

        {/* Mode Switcher Tabs */}
        <div className="grid grid-cols-2 p-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-semibold text-zinc-400">
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(''); }}
            className={`py-2 rounded-md transition ${mode === 'signin' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'hover:text-zinc-200'}`}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); }}
            className={`py-2 rounded-md transition ${mode === 'signup' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'hover:text-zinc-200'}`}
          >
            Crear Cuenta
          </button>
        </div>

        {/* shadcn Card Container */}
        <Card className="border border-zinc-800 bg-zinc-900/90 shadow-2xl backdrop-blur-md">
          <CardHeader className="text-center border-b border-zinc-800/80 pb-4 space-y-1">
            <CardTitle className="text-lg font-semibold text-zinc-100">
              {mode === 'signin' ? 'Bienvenido de Nuevo' : 'Registrar Nueva Cuenta'}
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              {mode === 'signin' ? 'Ingresa tus credenciales corporativas para acceder' : 'Completa tus datos para crear tu cuenta en Synckre'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {error && (
              <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5 font-mono">
                <ShieldAlert className="size-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Google OAuth Button */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full h-10 bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-200 text-xs font-semibold gap-2 transition"
            >
              <svg className="size-4" viewBox="0 0 24 24">
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

            <div className="relative flex items-center justify-center my-2">
              <div className="border-t border-zinc-800 w-full" />
              <span className="bg-zinc-900 px-3 text-[10px] uppercase font-mono text-zinc-500 shrink-0">
                o con correo electrónico
              </span>
            </div>

            {/* Formulario Sign In */}
            {mode === 'signin' ? (
              <form onSubmit={handleSignInSubmit} className="space-y-4">
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
                  {loading ? 'Autenticando...' : <>Ingresar al Panel <ArrowRight className="size-4" /></>}
                </Button>
              </form>
            ) : (
              /* Formulario Sign Up */
              <form onSubmit={handleSignUpSubmit} className="space-y-4">
                {!verifyingCode ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                          <User className="size-3.5 text-zinc-400" />
                          Nombre
                        </label>
                        <Input
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Juan"
                          required
                          className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-600 text-xs h-10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-300">Apellido</label>
                        <Input
                          type="text"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Pérez"
                          required
                          className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-600 text-xs h-10"
                        />
                      </div>
                    </div>

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
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-600 text-xs h-10"
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
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-600 text-xs h-10"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={loading || !email.trim() || !password || !firstName.trim()}
                      className="w-full h-10 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-semibold shadow-md gap-2 transition"
                    >
                      {loading ? 'Creando Cuenta...' : <>Crear Cuenta <ArrowRight className="size-4" /></>}
                    </Button>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 font-mono">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                      <span>Te enviamos un código de verificación a tu correo.</span>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-300">Código de Verificación (6 dígitos)</label>
                      <Input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="123456"
                        required
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 text-xs h-10 font-mono tracking-widest text-center"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={loading || !code.trim()}
                      className="w-full h-10 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-semibold gap-2"
                    >
                      {loading ? 'Verificando...' : 'Verificar y Entrar'}
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
