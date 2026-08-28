'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Props = {
  availability: { google: boolean; apple: boolean };
  returnTo: string;
  initialError: string;
  initialMfa: boolean;
};

export default function LoginForm({ availability, returnTo, initialError, initialMfa }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [challengeToken, setChallengeToken] = useState(initialMfa ? 'cookie' : '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const payload = mode === 'login'
      ? { identifier: form.get('identifier'), password: form.get('password') }
      : { displayName: form.get('displayName'), username: form.get('username'), email: form.get('email'), password: form.get('password') };
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string; mfaRequired?: boolean; challengeToken?: string; verificationEmailSent?: boolean };
      if (!response.ok) setError(result.error ?? 'No pudimos completar la operación.');
      else if (result.mfaRequired && result.challengeToken) setChallengeToken(result.challengeToken);
      else if (mode === 'register') router.push(`/verify-email?sent=${result.verificationEmailSent ? '1' : '0'}&return_to=${encodeURIComponent(returnTo)}`);
      else window.location.assign(returnTo);
    } catch {
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/mfa/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challengeToken === 'cookie' ? undefined : challengeToken, code: form.get('code') }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) setError(result.error ?? 'No pudimos validar el código.');
      else window.location.assign(returnTo);
    } catch {
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.');
    } finally { setBusy(false); }
  }

  function changeMode(next: 'login' | 'register') {
    setMode(next);
    setError('');
  }

  if (challengeToken) return (
    <div className="auth-box">
      <div className="auth-heading"><small>SEGUNDO FACTOR</small><h2>Confirmá que sos vos</h2><p>Ingresá el código de seis dígitos de tu autenticador o uno de tus códigos de recuperación.</p></div>
      <form className="auth-form auth-secondary-form" onSubmit={verifyMfa}>
        <label>Código de seguridad<input name="code" autoComplete="one-time-code" inputMode="numeric" maxLength={40} autoFocus placeholder="000000" required /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? 'Validando…' : 'Verificar e ingresar →'}</button>
        <button type="button" className="auth-text-button" onClick={() => { setChallengeToken(''); setError(''); }}>Volver al inicio de sesión</button>
      </form>
    </div>
  );

  return (
    <div className="auth-box">
      <div className="auth-heading"><small>ACCESO SEGURO</small><h2>{mode === 'login' ? 'Ingresá a tu cuenta' : 'Creá tu cuenta'}</h2><p>{mode === 'login' ? 'Administrá tu organización y el entorno sandbox.' : 'Configurá tu espacio de trabajo en menos de un minuto.'}</p></div>
      <div className="auth-tabs" role="tablist" aria-label="Tipo de acceso">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>Ingresar</button>
        <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')}>Crear cuenta</button>
      </div>
      <div className="oauth-buttons">
        <a aria-disabled={!availability.google} href={availability.google ? `/api/auth/oauth/google/start?return_to=${encodeURIComponent(returnTo)}` : undefined} title={!availability.google ? 'Requiere credenciales OAuth de Google' : undefined}><GoogleIcon /> Continuar con Google</a>
        <a aria-disabled={!availability.apple} href={availability.apple ? `/api/auth/oauth/apple/start?return_to=${encodeURIComponent(returnTo)}` : undefined} title={!availability.apple ? 'Requiere credenciales de Sign in with Apple' : undefined}><AppleIcon /> Continuar con Apple</a>
      </div>
      <div className="auth-divider"><span>o usá tus credenciales</span></div>
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && <><label>Nombre completo<input name="displayName" autoComplete="name" minLength={2} maxLength={100} placeholder="Sofía Martínez" required /></label><label>Nombre de usuario<input name="username" autoComplete="username" minLength={3} maxLength={30} pattern="[a-zA-Z0-9._-]+" placeholder="sofia.martinez" required /><small>Letras, números, punto, guion o guion bajo.</small></label><label>Email corporativo<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="sofia@empresa.com" required /></label></>}
        {mode === 'login' && <label>Email o usuario<input name="identifier" autoComplete="username" maxLength={254} placeholder="sofia@empresa.com" required /></label>}
        <label>Contraseña<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} maxLength={128} placeholder="Mínimo 12 caracteres" required />{mode === 'register' && <small>Usá una frase única de al menos 12 caracteres.</small>}</label>
        {mode === 'login' && <Link className="auth-forgot" href="/forgot-password">¿Olvidaste tu contraseña?</Link>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? 'Procesando…' : mode === 'login' ? 'Ingresar a la consola →' : 'Crear cuenta →'}</button>
      </form>
      {(!availability.google || !availability.apple) && <p className="oauth-config-note">Los proveedores desactivados se habilitan al cargar sus credenciales verificadas en el entorno.</p>}
    </div>
  );
}

function GoogleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4L15.4 17c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.5 13.9A6 6 0 0 1 6.2 12c0-.7.1-1.3.3-1.9V7.4H3.1A10 10 0 0 0 2 12c0 1.7.4 3.2 1.1 4.6l3.4-2.7Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.8 9.8 0 0 0 12 2a10 10 0 0 0-8.9 5.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z"/></svg>;
}

function AppleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.2 12.8c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.7.9-.8 0-1.9-.9-3.1-.9a4.8 4.8 0 0 0-4.1 2.5c-1.8 3-.4 7.5 1.2 10 .8 1.2 1.8 2.5 3.1 2.4 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.4 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-3.9ZM14.7 5.4a4.3 4.3 0 0 0 1-3.2 4.5 4.5 0 0 0-3 1.5 4.1 4.1 0 0 0-1.1 3c1.1.1 2.2-.5 3.1-1.3Z"/></svg>;
}
