'use client';

import React, { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Mail, Lock, ArrowRight, Eye, EyeOff, User, CheckCircle2 } from 'lucide-react';

const inputClass =
  'bg-zinc-950 border-zinc-800 text-zinc-100 placeholder-zinc-500 text-sm h-11 focus:border-zinc-700';

function messageFromClerk(err: unknown): string {
  const clerkErr = err as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  const raw =
    clerkErr?.errors?.[0]?.longMessage ||
    clerkErr?.errors?.[0]?.message ||
    clerkErr?.message ||
    '';
  if (/password is incorrect/i.test(raw)) {
    return 'Contraseña incorrecta. Prueba de nuevo.';
  }
  if (/15 characters or more|at least 15/i.test(raw)) {
    return 'Clerk sigue pidiendo 15 caracteres. Bájalo en dashboard.clerk.com → User & authentication → Password → Update password requirements → Minimum length: 8.';
  }
  if (/couldn't find your account|identifier|not found/i.test(raw)) {
    return 'No encontramos esa cuenta. Revisa el correo o crea una.';
  }
  if (/already exists|taken/i.test(raw)) {
    return 'Ese correo ya tiene cuenta. Inicia sesión.';
  }
  return raw || 'Error de autenticación.';
}

function PasswordField({
  id,
  autoComplete,
  value,
  onChange,
  showPassword,
  onToggle,
}: {
  id: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  showPassword: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••••••"
          required
          minLength={8}
          className={`${inputClass} pr-11`}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-zinc-500 hover:text-zinc-200"
          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">Mínimo 8 caracteres.</p>
    </div>
  );
}

export default function LoginPage() {
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError('');
    setVerifyingCode(false);
    setCode('');
    setShowPassword(false);
  };

  const handleSignInSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isSignInLoaded || !signIn || loading) return;

    const data = new FormData(e.currentTarget);
    const emailVal = String(data.get('identifier') || email).trim();
    const passwordVal = String(data.get('password') || password);

    if (!emailVal || !passwordVal) {
      setError('Escribe el correo y la contraseña.');
      return;
    }

    setEmail(emailVal);
    setPassword(passwordVal);
    setLoading(true);
    setError('');

    try {
      const result = await signIn.create({
        identifier: emailVal,
        password: passwordVal,
      });

      if (result.status === 'complete' && result.createdSessionId) {
        await setSignInActive({ session: result.createdSessionId });
        router.replace('/dashboard');
        return;
      }

      setError('No se pudo completar el inicio de sesión. Revisa tus credenciales.');
    } catch (err: unknown) {
      console.error(err);
      setError(messageFromClerk(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isSignUpLoaded || !signUp || loading) return;

    const data = new FormData(e.currentTarget);
    const emailVal = String(data.get('email') || email).trim();
    const passwordVal = String(data.get('password') || password);
    const firstVal = String(data.get('firstName') || firstName).trim();
    const lastVal = String(data.get('lastName') || lastName).trim();
    const codeVal = String(data.get('code') || code).trim();

    setLoading(true);
    setError('');

    try {
      if (!verifyingCode) {
        if (!emailVal || !passwordVal || !firstVal) {
          setError('Completa nombre, correo y contraseña.');
          setLoading(false);
          return;
        }
        setEmail(emailVal);
        setPassword(passwordVal);
        setFirstName(firstVal);
        setLastName(lastVal);

        await signUp.create({
          emailAddress: emailVal,
          password: passwordVal,
          firstName: firstVal,
          lastName: lastVal,
        });

        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setVerifyingCode(true);
      } else {
        const completeSignUp = await signUp.attemptEmailAddressVerification({
          code: codeVal,
        });

        if (completeSignUp.status === 'complete' && completeSignUp.createdSessionId) {
          await setSignUpActive({ session: completeSignUp.createdSessionId });
          router.replace('/dashboard');
          return;
        }
        setError('Código de verificación incorrecto.');
      }
    } catch (err: unknown) {
      console.error(err);
      setError(messageFromClerk(err));
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

        <div className="grid grid-cols-2 p-1 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-medium text-zinc-400">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`py-2.5 rounded-lg transition-all ${mode === 'signin' ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm' : 'hover:text-zinc-200'}`}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`py-2.5 rounded-lg transition-all ${mode === 'signup' ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm' : 'hover:text-zinc-200'}`}
          >
            Crear Cuenta
          </button>
        </div>

        <Card className="border border-zinc-800 bg-zinc-900/90 shadow-2xl backdrop-blur-md">
          <CardContent className="p-6 space-y-5 pt-6">
            {error && (
              <div className="p-4 rounded-xl bg-red-950/50 border border-red-500/30 text-red-400 text-sm flex items-start gap-3">
                <ShieldAlert className="size-5 text-red-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {mode === 'signin' ? (
              <form onSubmit={handleSignInSubmit} className="space-y-4" autoComplete="on">
                <div className="space-y-2">
                  <label htmlFor="login-email" className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                    <Mail className="size-4 text-zinc-400" />
                    Correo Electrónico
                  </label>
                  <Input
                    id="login-email"
                    name="identifier"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@synckre.com"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                    <Lock className="size-4 text-zinc-400" />
                    Contraseña
                  </label>
                  <PasswordField
                    id="login-password"
                    autoComplete="current-password"
                    value={password}
                    onChange={setPassword}
                    showPassword={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading || !isSignInLoaded}
                  className="w-full h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-sm font-semibold shadow-md gap-2 transition"
                >
                  {loading ? 'Autenticando...' : <>Ingresar al Panel <ArrowRight className="size-4" /></>}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignUpSubmit} className="space-y-4" autoComplete="on">
                {!verifyingCode ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label htmlFor="signup-first" className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
                          <User className="size-4 text-zinc-400" />
                          Nombre
                        </label>
                        <Input
                          id="signup-first"
                          name="firstName"
                          type="text"
                          autoComplete="given-name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Juan"
                          required
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="signup-last" className="text-sm font-medium text-zinc-200">
                          Apellido
                        </label>
                        <Input
                          id="signup-last"
                          name="lastName"
                          type="text"
                          autoComplete="family-name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Pérez"
                          className={inputClass}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="signup-email" className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                        <Mail className="size-4 text-zinc-400" />
                        Correo Electrónico
                      </label>
                      <Input
                        id="signup-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="usuario@synckre.com"
                        required
                        className={inputClass}
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="signup-password" className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                        <Lock className="size-4 text-zinc-400" />
                        Contraseña
                      </label>
                      <PasswordField
                        id="signup-password"
                        autoComplete="new-password"
                        value={password}
                        onChange={setPassword}
                        showPassword={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={loading || !isSignUpLoaded}
                      className="w-full h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-sm font-semibold shadow-md gap-2 transition"
                    >
                      {loading ? 'Creando cuenta...' : <>Crear Cuenta <ArrowRight className="size-4" /></>}
                    </Button>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2.5">
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
                      <span>Te enviamos un código de verificación a {email || 'tu correo'}.</span>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="signup-code" className="text-sm font-medium text-zinc-200">
                        Código de verificación
                      </label>
                      <Input
                        id="signup-code"
                        name="code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="123456"
                        required
                        className={`${inputClass} font-mono tracking-widest text-center`}
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={loading || !isSignUpLoaded}
                      className="w-full h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-sm font-semibold gap-2"
                    >
                      {loading ? 'Verificando...' : 'Verificar y entrar'}
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
