'use client';

import { useState, type FormEvent } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { findEmailCodeFactor, type SignInAttempt } from '@/lib/clerk-factors';
import { messageFromClerk } from '@/lib/clerk-errors';

export type AuthMode = 'signin' | 'signup';

export function useEmailAuth() {
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [signInCodeKind, setSignInCodeKind] = useState<'first' | 'second' | null>(null);
  const [signInEmailAddressId, setSignInEmailAddressId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const resetVerification = () => {
    setVerifyingCode(false);
    setCode('');
    setSignInCodeKind(null);
    setSignInEmailAddressId(null);
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    resetVerification();
  };

  const goBackFromCode = () => {
    resetVerification();
    setError('');
  };

  const activateSignInSession = async (sessionId: string | null | undefined) => {
    if (!sessionId || !setSignInActive) {
      setError('No se pudo crear la sesión.');
      return false;
    }
    await setSignInActive({ session: sessionId });
    router.replace('/dashboard');
    return true;
  };

  const startSignInEmailCode = async (attempt: SignInAttempt) => {
    const status = attempt.status;
    const needsSecond = status === 'needs_second_factor' || status === 'needs_client_trust';

    if (needsSecond) {
      const emailCodeFactor = findEmailCodeFactor(attempt.supportedSecondFactors);
      if (!emailCodeFactor) {
        setError('Tu cuenta pide un segundo factor que este formulario no soporta.');
        return false;
      }
      await signIn!.prepareSecondFactor({
        strategy: 'email_code',
        emailAddressId: emailCodeFactor.emailAddressId,
      });
      setSignInEmailAddressId(emailCodeFactor.emailAddressId);
      setSignInCodeKind('second');
      setVerifyingCode(true);
      setCode('');
      return true;
    }

    if (status === 'needs_first_factor') {
      const emailCodeFactor = findEmailCodeFactor(attempt.supportedFirstFactors);
      if (!emailCodeFactor) {
        setError('No se pudo completar el inicio de sesión. Revisa tus credenciales.');
        return false;
      }
      await signIn!.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: emailCodeFactor.emailAddressId,
      });
      setSignInEmailAddressId(emailCodeFactor.emailAddressId);
      setSignInCodeKind('first');
      setVerifyingCode(true);
      setCode('');
      return true;
    }

    setError(`No se pudo completar el inicio de sesión (estado: ${status}).`);
    return false;
  };

  const handleSignInSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isSignInLoaded || !signIn || loading) return;

    const data = new FormData(e.currentTarget);
    setLoading(true);
    setError('');

    try {
      if (verifyingCode) {
        const codeVal = String(data.get('code') || code).trim();
        if (!codeVal) {
          setError('Escribe el código de verificación.');
          setLoading(false);
          return;
        }

        const result =
          signInCodeKind === 'first'
            ? await signIn.attemptFirstFactor({ strategy: 'email_code', code: codeVal })
            : await signIn.attemptSecondFactor({ strategy: 'email_code', code: codeVal });

        if (result.status === 'complete') {
          await activateSignInSession(result.createdSessionId);
          return;
        }

        setError('Código de verificación incorrecto.');
        return;
      }

      const emailVal = String(data.get('identifier') || email).trim();
      const passwordVal = String(data.get('password') || password);

      if (!emailVal || !passwordVal) {
        setError('Escribe el correo y la contraseña.');
        return;
      }

      setEmail(emailVal);
      setPassword(passwordVal);

      const result = await signIn.create({
        identifier: emailVal,
        password: passwordVal,
      });

      if (result.status === 'complete' && result.createdSessionId) {
        await activateSignInSession(result.createdSessionId);
        return;
      }

      await startSignInEmailCode(result as SignInAttempt);
    } catch (err: unknown) {
      console.error(err);
      setError(messageFromClerk(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendSignInCode = async () => {
    if (!signIn || !signInEmailAddressId || resending || loading) return;
    setResending(true);
    setError('');
    try {
      if (signInCodeKind === 'first') {
        await signIn.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: signInEmailAddressId,
        });
      } else {
        await signIn.prepareSecondFactor({
          strategy: 'email_code',
          emailAddressId: signInEmailAddressId,
        });
      }
    } catch (err: unknown) {
      console.error(err);
      setError(messageFromClerk(err));
    } finally {
      setResending(false);
    }
  };

  const handleResendSignUpCode = async () => {
    if (!signUp || resending || loading) return;
    setResending(true);
    setError('');
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
    } catch (err: unknown) {
      console.error(err);
      setError(messageFromClerk(err));
    } finally {
      setResending(false);
    }
  };

  const handleSignUpSubmit = async (e: FormEvent<HTMLFormElement>) => {
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

  return {
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
  };
}
