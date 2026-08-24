type ClerkErrorShape = {
  errors?: { longMessage?: string; message?: string }[];
  message?: string;
};

export function messageFromClerk(err: unknown): string {
  const clerkErr = err as ClerkErrorShape;
  const raw =
    clerkErr?.errors?.[0]?.longMessage ||
    clerkErr?.errors?.[0]?.message ||
    clerkErr?.message ||
    '';
  if (/password is incorrect/i.test(raw)) {
    return 'Contraseña incorrecta. Prueba de nuevo.';
  }
  if (/couldn't find your account|identifier|not found/i.test(raw)) {
    return 'No encontramos esa cuenta. Revisa el correo o crea una.';
  }
  if (/already exists|taken/i.test(raw)) {
    return 'Ese correo ya tiene cuenta. Inicia sesión.';
  }
  if (/incorrect|invalid|expired/i.test(raw) && /code|verif/i.test(raw)) {
    return 'Código incorrecto o caducado. Solicita uno nuevo.';
  }
  return raw || 'Error de autenticación.';
}
