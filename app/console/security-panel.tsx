'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type SecurityUser = { email: string; emailVerified: boolean; mfaEnabled: boolean; recoveryCodeCount: number };
type Setup = { secret: string; provisioningUri: string; qrDataUrl: string };

export default function SecurityPanel({ user }: { user: SecurityUser }) {
  const router = useRouter();
  const [emailVerified] = useState(user.emailVerified);
  const [mfaEnabled, setMfaEnabled] = useState(user.mfaEnabled);
  const [recoveryCount, setRecoveryCount] = useState(user.recoveryCodeCount);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function resendVerification() {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/auth/email/resend', { method: 'POST' });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? 'Enviamos un nuevo enlace de verificación.' : result.error ?? 'No pudimos enviar la verificación.');
    setBusy(false);
  }

  async function startSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch('/api/auth/mfa/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.get('currentPassword') }),
    });
    const result = await response.json() as Setup & { error?: string };
    if (response.ok) setSetup(result); else setFeedback(result.error ?? 'No pudimos iniciar la configuración.');
    setBusy(false);
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch('/api/auth/mfa/enable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: form.get('code') }),
    });
    const result = await response.json() as { error?: string; recoveryCodes?: string[] };
    if (response.ok && result.recoveryCodes) {
      setRecoveryCodes(result.recoveryCodes); setRecoveryCount(result.recoveryCodes.length); setMfaEnabled(true); setSetup(null);
      setFeedback('MFA quedó activo. Guardá ahora los códigos de recuperación: no volveremos a mostrarlos.');
    } else setFeedback(result.error ?? 'No pudimos activar MFA.');
    setBusy(false);
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch('/api/auth/mfa/disable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: form.get('currentPassword'), code: form.get('code') }),
    });
    const result = await response.json() as { error?: string };
    if (response.ok) { router.push('/login'); router.refresh(); } else { setFeedback(result.error ?? 'No pudimos desactivar MFA.'); setBusy(false); }
  }

  function downloadRecoveryCodes() {
    const blob = new Blob([`CIMBRA — CÓDIGOS DE RECUPERACIÓN\n\n${recoveryCodes.join('\n')}\n\nCada código funciona una sola vez. Guardalos fuera de línea.\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cimbra-recovery-codes.txt'; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="module-view security-view"><div className="module-view-head"><div><p>IDENTIDAD Y ACCESO</p><h1>Seguridad de la cuenta</h1><span>Verificación de email, segundo factor y recuperación segura.</span></div><span className="module-health"><i /> Sesión protegida</span></div>{feedback && <div className="form-feedback security-feedback" role="status">{feedback}</div>}<div className="security-grid"><article className="security-card"><div className="security-card-head"><i>{emailVerified ? '✓' : '@'}</i><div><h2>Email de la cuenta</h2><p>{user.email}</p></div><b className={emailVerified ? 'secure' : 'pending'}>{emailVerified ? 'VERIFICADO' : 'PENDIENTE'}</b></div><p>{emailVerified ? 'La dirección fue validada y puede usarse para recuperación y alertas de seguridad.' : 'Verificá la dirección antes de habilitar operaciones sensibles.'}</p>{!emailVerified && <button onClick={resendVerification} disabled={busy}>Reenviar verificación</button>}</article><article className="security-card"><div className="security-card-head"><i>⌾</i><div><h2>Autenticación multifactor</h2><p>TOTP compatible con apps estándar</p></div><b className={mfaEnabled ? 'secure' : 'pending'}>{mfaEnabled ? 'ACTIVA' : 'INACTIVA'}</b></div><p>{mfaEnabled ? `El segundo factor protege cada inicio de sesión. Quedan ${recoveryCount} códigos de recuperación.` : 'Agregá un código temporal de seis dígitos además de tu contraseña.'}</p></article></div>{recoveryCodes.length > 0 ? <article className="security-setup"><div><small>PASO FINAL</small><h2>Guardá tus códigos de recuperación</h2><p>Son de un solo uso y están guardados en Cimbra únicamente como hash.</p></div><div className="recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><button onClick={downloadRecoveryCodes}>Descargar códigos ↓</button></article> : setup ? <article className="security-setup"><div><small>VINCULAR AUTENTICADOR</small><h2>Escaneá el código QR</h2><p>Usá cualquier app compatible con TOTP. Después ingresá el código actual para confirmar.</p></div><div className="mfa-enrollment"><Image unoptimized width={190} height={190} src={setup.qrDataUrl} alt="Código QR para vincular el autenticador" /><div><small>CLAVE MANUAL</small><code>{setup.secret}</code><form onSubmit={confirmSetup}><label>Código de seis dígitos<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><button disabled={busy}>{busy ? 'Validando…' : 'Activar MFA →'}</button></form></div></div></article> : !mfaEnabled ? <article className="security-setup"><div><small>SEGUNDO FACTOR</small><h2>Activar MFA</h2><p>Confirmá tu contraseña para generar una vinculación privada. Si tu cuenta usa sólo Google o Apple, dejala vacía.</p></div><form className="security-inline-form" onSubmit={startSetup}><label>Contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} /></label><button disabled={busy}>{busy ? 'Preparando…' : 'Configurar autenticador →'}</button></form></article> : <article className="security-setup danger-zone"><div><small>ZONA SENSIBLE</small><h2>Desactivar MFA</h2><p>Requiere contraseña y un factor vigente. Al terminar se cerrarán todas las sesiones.</p></div><form className="security-inline-form" onSubmit={disable}><label>Contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} /></label><label>Código TOTP o recovery<input name="code" autoComplete="one-time-code" maxLength={40} required /></label><button disabled={busy}>{busy ? 'Validando…' : 'Desactivar y cerrar sesiones'}</button></form></article>}</div>;
}
