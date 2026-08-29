'use client';

import { useState } from 'react';

export default function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1600);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2000);
    }
  }

  return <button className="docs-copy" type="button" onClick={() => void copy()} aria-live="polite">
    {state === 'copied' ? 'Copiado ✓' : state === 'error' ? 'No se pudo copiar' : label}
  </button>;
}
