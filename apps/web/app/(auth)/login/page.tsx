'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Mail, Lock, ArrowRight, User } from 'lucide-react';
import { PasswordField } from '@/components/auth/PasswordField';
import { VerificationCodeStep } from '@/components/auth/VerificationCodeStep';
import { AUTH_INPUT_CLASS } from '@/components/auth/styles';
import { useEmailAuth } from '@/hooks/useEmailAuth';

export default function LoginPage() {
  const {
    mode,
    email,
    setEmail,
    password,
    setPassword,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    code,
    setCode,
    verifyingCode,
    error,
    loading,
    resending,
    isSignInLoaded,
    isSignUpLoaded,
    switchMode,
    goBackFromCode,
    handleSignInSubmit,
    handleSignUpSubmit,
    handleResendSignInCode,
    handleResendSignUpCode,
  } = useEmailAuth();

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
                {!verifyingCode ? (
                  <>
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
                        className={AUTH_INPUT_CLASS}
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
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={loading || !isSignInLoaded}
                      className="w-full h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-sm font-semibold shadow-md gap-2 transition"
                    >
                      {loading ? 'Autenticando...' : <>Ingresar al Panel <ArrowRight className="size-4" /></>}
                    </Button>
                  </>
                ) : (
                  <VerificationCodeStep
                    email={email}
                    code={code}
                    onCodeChange={setCode}
                    loading={loading}
                    disabled={!isSignInLoaded}
                    resending={resending}
                    onResend={handleResendSignInCode}
                    onBack={goBackFromCode}
                  />
                )}
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
                          className={AUTH_INPUT_CLASS}
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
                          className={AUTH_INPUT_CLASS}
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
                        className={AUTH_INPUT_CLASS}
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
                  <VerificationCodeStep
                    email={email}
                    code={code}
                    onCodeChange={setCode}
                    loading={loading}
                    disabled={!isSignUpLoaded}
                    resending={resending}
                    onResend={handleResendSignUpCode}
                    onBack={goBackFromCode}
                  />
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
