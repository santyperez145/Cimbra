'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { jsonFetch } from '@/app/lib/platform/client-http';

export default function VerifyEmailForm({ token, sent, returnTo }: { token: string; sent: boolean; returnTo: string }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>(token ? 'busy' : 'idle');
  const [message, setMessage] = useState(sent ? 'Te enviamos un enlace de verificación. Revisá también la carpeta de spam.' : 'El envío de email no está configurado en este entorno. Podés continuar usando el sandbox y verificarlo cuando se active el proveedor.');

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(null, '', '/verify-email');
    jsonFetch('/api/auth/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (response) => ({ response, result: await response.json() as { error?: string } }))
      .then(({ response, result }) => { if (response.ok) { setStatus('done'); setMessage('Tu email quedó verificado correctamente.'); } else { setStatus('error'); setMessage(result.error ?? 'No pudimos verificar el email.'); } })
      .catch(() => { setStatus('error'); setMessage('No pudimos conectarnos. Intentá nuevamente.'); });
  }, [token]);

  async function resend() {
    setStatus('busy');
    const response = await jsonFetch('/api/auth/email/resend', { method: 'POST' });
    const result = await response.json() as { error?: string };
    setStatus(response.ok ? 'idle' : 'error');
    setMessage(response.ok ? 'Enviamos un nuevo enlace. El anterior quedó invalidado.' : result.error ?? 'No pudimos enviar el email.');
  }

  return <div className="auth-box"><div className="auth-heading"><small>IDENTIDAD DE CUENTA</small><h2>{status === 'done' ? 'Email verificado' : 'Verificá tu email'}</h2><p>{status === 'busy' ? 'Validando el enlace seguro…' : message}</p></div><div className="auth-secondary-actions">{status !== 'done' && !token && <button className="auth-submit" onClick={resend} disabled={status === 'busy'}>Reenviar verificación</button>}<Link className="auth-complete-link" href={returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/console'}>{status === 'done' ? 'Continuar a la consola →' : 'Continuar al sandbox →'}</Link><Link className="auth-back" href="/login">Usar otra cuenta</Link></div></div>;
}
