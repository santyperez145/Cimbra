'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { jsonFetch } from '@/app/lib/platform/client-http';

export default function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await jsonFetch('/api/auth/password/forgot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email') }),
      });
      const result = await response.json() as { error?: string; message?: string };
      setFeedback(response.ok ? result.message ?? 'Revisá tu email.' : result.error ?? 'No pudimos procesar la solicitud.');
    } catch { setFeedback('No pudimos conectarnos. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }

  return <div className="auth-box"><div className="auth-heading"><small>RECUPERACIÓN SEGURA</small><h2>Restablecé tu acceso</h2><p>Te enviaremos un enlace de un solo uso si el email corresponde a una cuenta verificada.</p></div><form className="auth-form auth-secondary-form" onSubmit={submit}><label>Email de la cuenta<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>{feedback && <div className="auth-info" role="status">{feedback}</div>}<button className="auth-submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace seguro →'}</button><Link className="auth-back" href="/login">← Volver al inicio de sesión</Link></form></div>;
}
