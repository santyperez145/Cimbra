'use client';

import { FormEvent, useState } from 'react';
import { jsonFetch } from '@/app/lib/platform/client-http';

export default function DemoForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending'); setMessage('');
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form).entries());
    const response = await jsonFetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    const result = await response.json() as { message?: string; error?: string };
    if (!response.ok) { setState('error'); setMessage(result.error ?? 'No pudimos enviar la solicitud.'); return; }
    setState('sent'); setMessage(result.message ?? 'Solicitud recibida.'); form.reset();
  }

  return <form className="demo-form" onSubmit={submit}>
    <div className="form-grid"><label>Nombre y apellido<input name="name" required minLength={2} placeholder="Tu nombre" /></label><label>Empresa<input name="company" required minLength={2} placeholder="Nombre de tu empresa" /></label><label>Email corporativo<input name="email" type="email" required placeholder="vos@empresa.com" /></label><label>Volumen mensual<select name="volume" required defaultValue=""><option value="" disabled>Seleccionar</option><option>Hasta USD 100k</option><option>USD 100k – 1M</option><option>USD 1M – 10M</option><option>Más de USD 10M</option></select></label></div>
    <label>¿Qué querés lanzar?<textarea name="message" rows={3} placeholder="Contanos sobre el producto, mercado y timing…" /></label>
    {message && <div className={`demo-feedback ${state}`}>{message}</div>}
    <button className="button button-coral" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Solicitar sesión de diseño'} <span>↗</span></button>
    <small>Usamos estos datos para responder tu solicitud según nuestra <a href="/privacy">política de privacidad</a>. No ingreses información financiera sensible.</small>
  </form>;
}
