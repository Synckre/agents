'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AUTH_INPUT_CLASS } from '@/components/auth/styles';

export function PasswordField({
  id,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
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
        className={`${AUTH_INPUT_CLASS} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShowPassword((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-zinc-500 hover:text-zinc-200"
        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
