'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { jsonFetch } from '@/app/lib/platform/client-http';

export default function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? '' : 'El enlace no contiene un token válido.');

  useEffect(() => {
    if (token) window.history.replaceState(null, '', '/reset-password');
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmation') ?? '')) { setError('Las contraseñas no coinciden.'); setBusy(false); return; }
    try {
      const response = await jsonFetch('/api/auth/password/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) setError(result.error ?? 'No pudimos actualizar la contraseña.'); else setDone(true);
    } catch { setError('No pudimos conectarnos. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }

  if (done) return <div className="auth-box"><div className="auth-heading"><small>ACCESO RECUPERADO</small><h2>Contraseña actualizada</h2><p>Cerramos las sesiones anteriores. Ya podés ingresar con tu nueva contraseña.</p></div><Link className="auth-complete-link" href="/login">Ingresar a Cimbra →</Link></div>;
  return <div className="auth-box"><div className="auth-heading"><small>NUEVA CREDENCIAL</small><h2>Creá una contraseña nueva</h2><p>Usá una frase única de entre 12 y 128 caracteres.</p></div><form className="auth-form auth-secondary-form" onSubmit={submit}><label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label>Repetir contraseña<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="auth-submit" disabled={busy || !token}>{busy ? 'Actualizando…' : 'Actualizar contraseña →'}</button><Link className="auth-back" href="/login">← Volver</Link></form></div>;
}
