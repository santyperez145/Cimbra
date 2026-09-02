'use client';

import { FormEvent, useState } from 'react';
import { jsonFetch } from '@/app/lib/platform/client-http';
import { type DemoIntent } from '@/app/lib/platform/capital-plan';

const defaultVolumeOptions = [
  { value: 'Hasta USD 100k', label: 'Hasta USD 100k' },
  { value: 'USD 100k – 1M', label: 'USD 100k – 1M' },
  { value: 'USD 1M – 10M', label: 'USD 1M – 10M' },
  { value: 'Más de USD 10M', label: 'Más de USD 10M' },
];

const investorVolumeOptions = [
  { value: 'Exploración', label: 'Exploración / intro' },
  { value: 'Pre-seed', label: 'Pre-seed' },
  { value: 'Seed', label: 'Seed' },
  { value: 'No aplica', label: 'No aplica / otro' },
];

type DemoFormProps = {
  intent?: DemoIntent;
  submitLabel?: string;
};

export default function DemoForm({ intent = 'design_session', submitLabel }: DemoFormProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const volumeOptions = intent === 'investor' ? investorVolumeOptions : defaultVolumeOptions;
  const volumeLabel = intent === 'investor' ? 'Instrumento' : 'Volumen mensual';
  const messagePlaceholder = intent === 'investor'
    ? 'Fondo, cheque objetivo, tesis y qué evidencia querés ver…'
    : 'Contanos sobre el producto, mercado y timing…';
  const buttonLabel = submitLabel ?? (intent === 'investor' ? 'Pedir data room' : 'Solicitar sesión de diseño');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending'); setMessage('');
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form).entries());
    const response = await jsonFetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, intent }) });
    const result = await response.json() as { message?: string; error?: string };
    if (!response.ok) { setState('error'); setMessage(result.error ?? 'No pudimos enviar la solicitud.'); return; }
    setState('sent'); setMessage(result.message ?? 'Solicitud recibida.'); form.reset();
  }

  return <form className="demo-form" onSubmit={submit}>
    <input type="hidden" name="intent" value={intent} />
    <div className="form-grid"><label>Nombre y apellido<input name="name" required minLength={2} placeholder="Tu nombre" /></label><label>Empresa<input name="company" required minLength={2} placeholder="Nombre de tu empresa" /></label><label>Email corporativo<input name="email" type="email" required placeholder="vos@empresa.com" /></label><label>{volumeLabel}<select name="volume" required defaultValue=""><option value="" disabled>Seleccionar</option>{volumeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
    <label>¿Qué querés lanzar?<textarea name="message" rows={3} placeholder={messagePlaceholder} /></label>
    {message && <div className={`demo-feedback ${state}`}>{message}</div>}
    <button className="button button-coral" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : <>{buttonLabel} <span>↗</span></>}</button>
    <small>Usamos estos datos para responder tu solicitud según nuestra <a href="/privacy">política de privacidad</a>. No ingreses información financiera sensible.</small>
  </form>;
}
