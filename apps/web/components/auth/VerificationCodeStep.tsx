'use client';

import { CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AUTH_INPUT_CLASS } from '@/components/auth/styles';

export function VerificationCodeStep({
  email,
  code,
  onCodeChange,
  loading,
  disabled,
  resending,
  onResend,
  onBack,
}: {
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  loading: boolean;
  disabled: boolean;
  resending: boolean;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2.5">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
        <span>Te enviamos un código de verificación a {email || 'tu correo'}.</span>
      </div>
      <div className="space-y-2">
        <label htmlFor="verification-code" className="text-sm font-medium text-zinc-200">
          Código de verificación
        </label>
        <Input
          id="verification-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="123456"
          required
          className={`${AUTH_INPUT_CLASS} font-mono tracking-widest text-center`}
        />
      </div>
      <Button
        type="submit"
        disabled={loading || disabled}
        className="w-full h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-sm font-semibold gap-2"
      >
        {loading ? 'Verificando...' : 'Verificar y entrar'}
      </Button>
      <div className="flex items-center justify-between gap-3 text-sm">
        <button type="button" onClick={onBack} className="text-zinc-400 hover:text-zinc-200">
          Volver
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={resending || loading}
          className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          {resending ? 'Reenviando...' : 'Reenviar código'}
        </button>
      </div>
    </div>
  );
}
