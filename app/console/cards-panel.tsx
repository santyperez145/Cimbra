'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Currency } from '@/app/lib/ledger/money';
import { CARD_CONTROL_CHANNELS, type CardControlChannel, type CardFormat, type CardProduct, type CardStatus } from '@/app/lib/platform/card-issuing';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: Currency; country: string; status: string };
type Card = {
  id: string; programId: string | null; programName: string | null; accountId: string; customerId: string;
  product: CardProduct; format: CardFormat; last4: string; status: CardStatus; statusReason: string | null;
  activatedAt: string | null; terminatedAt: string | null; createdAt: string; updatedAt: string;
};
type CardProgram = { id: string; name: string; product: CardProduct; formats: CardFormat[]; defaultCurrency: Currency; status: string; createdAt: string };
type LifecycleEvent = { id: string; fromStatus: CardStatus | null; toStatus: CardStatus; reason: string; actorName: string; createdAt: string };
type CardControls = {
  id: string; version: number; currency: Currency; perTransactionLimit: string | null; dailyLimit: string | null;
  monthlyLimit: string | null; allowedChannels: CardControlChannel[]; allowedMccs: string[]; blockedMccs: string[];
  status: 'active' | 'inactive'; createdByName: string; createdAt: string;
};

const PRODUCT_LABELS: Record<CardProduct, string> = { debit: 'Débito', credit: 'Crédito', prepaid: 'Prepaga' };
const FORMAT_LABELS: Record<CardFormat, string> = { virtual: 'Virtual', physical: 'Física' };
const STATUS_LABELS: Record<CardStatus, string> = { created: 'Pendiente de activación', active: 'Activa', frozen: 'Congelada', terminated: 'Terminada' };
const REASON_LABELS: Record<string, string> = {
  issued: 'Emisión', activation: 'Activación', user_request: 'Solicitud del usuario', internal_control: 'Control interno',
  suspected_fraud: 'Fraude sospechado', review_cleared: 'Revisión superada', lost: 'Pérdida', stolen: 'Robo',
  damaged: 'Daño', customer_request: 'Solicitud del cliente', expired: 'Vencimiento',
};
const CHANNEL_LABELS: Record<CardControlChannel, string> = {
  ecommerce: 'E-commerce', contactless: 'Contactless', chip: 'Chip', magstripe: 'Banda', atm: 'ATM',
};

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

function localizedDate(value: string) {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function CardsPanel({ initialCards, accounts, role }: {
  initialCards: Card[]; accounts: Account[]; role: OrganizationRole;
}) {
  const [cards, setCards] = useState(initialCards);
  const [programs, setPrograms] = useState<CardProgram[]>([]);
  const [selectedId, setSelectedId] = useState(initialCards[0]?.id ?? '');
  const [lifecycle, setLifecycle] = useState<LifecycleEvent[]>([]);
  const [controls, setControls] = useState<CardControls | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [terminationReason, setTerminationReason] = useState('customer_request');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(role, 'finance.write');
  const canManagePrograms = roleCan(role, 'cards.program.manage');
  const selectedCard = cards.find((card) => card.id === selectedId) ?? null;
  const selectedProgram = programs.find((program) => program.id === selectedProgramId) ?? null;
  const selectedAccount = accounts.find((account) => account.id === selectedCard?.accountId) ?? null;
  const displayedControls: CardControls | null = controls ?? (selectedCard && selectedAccount ? {
    id: `new-${selectedCard.id}`, version: 0, currency: selectedAccount.currency, perTransactionLimit: null,
    dailyLimit: null, monthlyLimit: null, allowedChannels: [...CARD_CONTROL_CHANNELS], allowedMccs: [], blockedMccs: [],
    status: 'active', createdByName: '', createdAt: '',
  } : null);
  const eligibleAccounts = useMemo(() => accounts.filter((account) => account.status === 'active'
    && (!selectedProgram || account.currency === selectedProgram.defaultCurrency)), [accounts, selectedProgram]);

  const loadInventory = useCallback(async () => {
    const [programResponse, cardResponse] = await Promise.all([
      authenticatedFetch('/api/v1/card-programs', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/cards?limit=100', { cache: 'no-store' }),
    ]);
    const programResult = await programResponse.json() as { data?: CardProgram[] };
    const cardResult = await cardResponse.json() as { data?: Card[] };
    if (!programResponse.ok) throw new Error(apiError(programResult, 'No pudimos cargar los programas.'));
    if (!cardResponse.ok) throw new Error(apiError(cardResult, 'No pudimos cargar las tarjetas.'));
    const nextPrograms = programResult.data ?? [];
    const nextCards = cardResult.data ?? [];
    setPrograms(nextPrograms);
    setCards(nextCards);
    setSelectedProgramId((current) => current || nextPrograms.find((program) => program.status === 'active')?.id || '');
    setSelectedId((current) => nextCards.some((card) => card.id === current) ? current : nextCards[0]?.id ?? '');
  }, []);

  const loadCardDetails = useCallback(async (cardId: string) => {
    if (!cardId) { setLifecycle([]); setControls(null); return; }
    const [lifecycleResponse, controlsResponse] = await Promise.all([
      authenticatedFetch(`/api/v1/cards/${cardId}/lifecycle`, { cache: 'no-store' }),
      authenticatedFetch(`/api/v1/cards/${cardId}/controls`, { cache: 'no-store' }),
    ]);
    const lifecycleResult = await lifecycleResponse.json() as { data?: LifecycleEvent[] };
    const controlsResult = await controlsResponse.json() as { controls?: CardControls | null };
    if (!lifecycleResponse.ok) throw new Error(apiError(lifecycleResult, 'No pudimos cargar el ciclo de vida.'));
    if (!controlsResponse.ok) throw new Error(apiError(controlsResult, 'No pudimos cargar los controles.'));
    setLifecycle(lifecycleResult.data ?? []);
    setControls(controlsResult.controls ?? null);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void loadInventory().catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [loadInventory]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadCardDetails(selectedId).catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [loadCardDetails, selectedId]);

  async function createProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const formats = (['virtual', 'physical'] as CardFormat[]).filter((format) => form.get(`format-${format}`) === 'on');
    const response = await authenticatedFetch('/api/v1/card-programs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: form.get('name'), product: form.get('product'), formats, defaultCurrency: form.get('currency') }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Programa creado y disponible para emisión.' : apiError(result, 'No pudimos crear el programa.'));
    if (response.ok) { formElement.reset(); await loadInventory(); }
    setBusy(false);
  }

  async function issueCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/cards', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ programId: form.get('programId'), accountId: form.get('accountId'), format: form.get('format') }),
    });
    const result = await response.json() as { card?: Card };
    setFeedback(response.ok ? `Tarjeta ${result.card?.format === 'physical' ? 'creada; requiere activación' : 'virtual activada'} en sandbox.`
      : apiError(result, 'No pudimos emitir la tarjeta.'));
    if (response.ok) { await loadInventory(); if (result.card?.id) setSelectedId(result.card.id); }
    setBusy(false);
  }

  async function transition(status: CardStatus, reason: string) {
    if (!selectedCard) return;
    if (status === 'terminated' && !window.confirm('La terminación es irreversible. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/cards/${selectedCard.id}/lifecycle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ status, reason }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? `Estado actualizado a ${STATUS_LABELS[status].toLowerCase()}.` : apiError(result, 'No pudimos cambiar el estado.'));
    if (response.ok) { await loadInventory(); await loadCardDetails(selectedCard.id); }
    setBusy(false);
  }

  async function updateControls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedCard || !selectedAccount) return;
    const form = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    const allowedChannels = CARD_CONTROL_CHANNELS.filter((channel) => form.get(`channel-${channel}`) === 'on');
    const mccs = (name: string) => String(form.get(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const optional = (name: string) => String(form.get(name) ?? '').trim() || null;
    const response = await authenticatedFetch(`/api/v1/cards/${selectedCard.id}/controls`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ currency: selectedAccount.currency, perTransactionLimit: optional('perTransactionLimit'),
        dailyLimit: optional('dailyLimit'), monthlyLimit: optional('monthlyLimit'), allowedChannels,
        allowedMccs: mccs('allowedMccs'), blockedMccs: mccs('blockedMccs'), status: form.get('status') }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Nueva versión de controles creada; el historial anterior permanece inmutable.'
      : apiError(result, 'No pudimos actualizar los controles.'));
    if (response.ok) await loadCardDetails(selectedCard.id);
    setBusy(false);
  }

  return <div className="module-view card-issuing-console">
    <div className="module-view-head"><div><p>CIMBRA ISSUING · SANDBOX</p><h1>Programas y tarjetas</h1><span>Emisión nativa, estados explícitos y controles versionados. Sin PAN, CVV ni conexión a redes reales.</span></div><span className="module-health"><i /> {cards.filter((card) => card.status === 'active').length} activas</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics card-metrics"><article><strong>{programs.filter((program) => program.status === 'active').length}</strong><span>programas activos</span></article><article><strong>{cards.length}</strong><span>instrumentos sandbox</span></article><article><strong>{cards.filter((card) => card.status === 'frozen').length}</strong><span>congeladas</span></article><article><strong>{cards.filter((card) => card.format === 'physical').length}</strong><span>físicas</span></article></div>

    <div className="card-issuing-actions">
      {canManagePrograms ? <article className="integration-card"><div className="card-head"><div><h2>Nuevo programa</h2><p>Owner y admin definen producto, formatos y moneda</p></div><b>API-FIRST</b></div><form className="integration-form" onSubmit={createProgram}><label>Nombre<input name="name" minLength={2} maxLength={80} placeholder="Débito regional ARS" required /></label><div className="integration-fields"><label>Producto<select name="product" defaultValue="debit"><option value="debit">Débito</option><option value="prepaid">Prepaga</option><option value="credit">Crédito</option></select></label><label>Moneda<select name="currency" defaultValue="ARS"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div><fieldset className="card-checkboxes"><legend>Formatos habilitados</legend><label><input name="format-virtual" type="checkbox" defaultChecked /> Virtual</label><label><input name="format-physical" type="checkbox" defaultChecked /> Física</label></fieldset><button disabled={busy}>Crear programa</button></form></article>
        : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Gobierno protegido</h2><p>Tu rol no modifica programas</p></div><b>READ ONLY</b></div><p>La definición de productos y monedas queda reservada a owner y admin. La operación nunca puede escalar privilegios.</p></article>}

      {canOperate ? <article className="integration-card"><div className="card-head"><div><h2>Emitir instrumento</h2><p>Vinculado a una cuenta del mismo tenant y moneda</p></div><b>SANDBOX</b></div><form className="integration-form" onSubmit={issueCard}><label>Programa<select name="programId" required value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)}><option value="" disabled>Seleccionar programa</option>{programs.filter((program) => program.status === 'active').map((program) => <option key={program.id} value={program.id}>{program.name} · {program.defaultCurrency}</option>)}</select></label><label>Cuenta<select name="accountId" required defaultValue="" key={selectedProgramId}><option value="" disabled>Seleccionar cuenta compatible</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference} · {account.currency}</option>)}</select></label><label>Formato<select name="format" required key={`${selectedProgramId}-format`}>{selectedProgram?.formats.map((format) => <option key={format} value={format}>{FORMAT_LABELS[format]}</option>)}</select></label><button disabled={busy || !selectedProgram || eligibleAccounts.length === 0}>Emitir tarjeta</button>{selectedProgram && eligibleAccounts.length === 0 && <small>No hay cuentas activas en {selectedProgram.defaultCurrency}.</small>}</form></article>
        : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Operación protegida</h2><p>Viewer conserva consulta y auditoría</p></div><b>READ ONLY</b></div><p>Emisión, cambios de estado y controles requieren owner, admin u operator. Las acciones no se renderizan para viewer.</p></article>}
    </div>

    <div className="card-workspace">
      <article className="card-inventory"><div className="card-head"><div><h2>Inventario</h2><p>Seleccioná una tarjeta para operar o auditar</p></div><b>{cards.length}</b></div>{cards.length === 0 ? <div className="card-empty"><strong>Sin tarjetas</strong><span>{canOperate ? 'Creá un programa y emití el primer instrumento.' : 'No hay instrumentos disponibles.'}</span></div> : cards.map((card) => <button key={card.id} className={`card-row ${selectedId === card.id ? 'selected' : ''}`} onClick={() => setSelectedId(card.id)}><span className={`card-status-dot ${card.status}`} /><span><strong>•••• {card.last4}</strong><small>{card.programName ?? PRODUCT_LABELS[card.product]} · {FORMAT_LABELS[card.format]}</small></span><b className={`card-state ${card.status}`}>{STATUS_LABELS[card.status]}</b></button>)}</article>

      <article className="card-detail">{selectedCard ? <><div className="card-detail-head"><div><small>{selectedCard.programName ?? 'SIN PROGRAMA'}</small><h2>•••• {selectedCard.last4}</h2><p>{PRODUCT_LABELS[selectedCard.product]} · {FORMAT_LABELS[selectedCard.format]} · {selectedAccount?.accountReference ?? selectedCard.accountId}</p></div><b className={`card-state ${selectedCard.status}`}>{STATUS_LABELS[selectedCard.status]}</b></div>
        {canOperate && selectedCard.status !== 'terminated' && <div className="card-lifecycle-actions">{selectedCard.status === 'created' && <button disabled={busy} onClick={() => void transition('active', 'activation')}>Activar</button>}{selectedCard.status === 'active' && <button disabled={busy} onClick={() => void transition('frozen', 'user_request')}>Congelar</button>}{selectedCard.status === 'frozen' && <button disabled={busy} onClick={() => void transition('active', 'review_cleared')}>Descongelar</button>}<select aria-label="Motivo de terminación" value={terminationReason} onChange={(event) => setTerminationReason(event.target.value)}><option value="customer_request">Solicitud del cliente</option><option value="lost">Pérdida</option><option value="stolen">Robo</option><option value="damaged">Daño</option><option value="suspected_fraud">Fraude sospechado</option><option value="expired">Vencimiento</option></select><button className="danger" disabled={busy} onClick={() => void transition('terminated', terminationReason)}>Terminar</button></div>}
        <div className="card-detail-columns"><section><h3>Controles vigentes</h3>{displayedControls ? <form className="card-controls-form" key={displayedControls.id} onSubmit={updateControls}><div className="card-control-meta"><span>{controls ? `Versión ${controls.version}` : 'Sin versión'}</span><span>{displayedControls.currency}</span><span>{displayedControls.status}</span></div><div className="integration-fields"><label>Por transacción<input name="perTransactionLimit" inputMode="decimal" defaultValue={displayedControls.perTransactionLimit ?? ''} placeholder="Sin límite" disabled={!canOperate} /></label><label>Diario<input name="dailyLimit" inputMode="decimal" defaultValue={displayedControls.dailyLimit ?? ''} placeholder="Sin límite" disabled={!canOperate} /></label></div><label>Mensual<input name="monthlyLimit" inputMode="decimal" defaultValue={displayedControls.monthlyLimit ?? ''} placeholder="Sin límite" disabled={!canOperate} /></label><fieldset className="card-checkboxes channel-grid"><legend>Canales permitidos</legend>{CARD_CONTROL_CHANNELS.map((channel) => <label key={channel}><input name={`channel-${channel}`} type="checkbox" defaultChecked={displayedControls.allowedChannels.includes(channel)} disabled={!canOperate} /> {CHANNEL_LABELS[channel]}</label>)}</fieldset><label>MCC permitidos<input name="allowedMccs" defaultValue={displayedControls.allowedMccs.join(', ')} placeholder="Ej. 5411, 5812" disabled={!canOperate} /></label><label>MCC bloqueados<input name="blockedMccs" defaultValue={displayedControls.blockedMccs.join(', ')} placeholder="Ej. 7995" disabled={!canOperate} /></label><label>Aplicación<select name="status" defaultValue={displayedControls.status} disabled={!canOperate}><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>{canOperate && <button disabled={busy || selectedCard.status === 'terminated'}>{controls ? 'Crear nueva versión' : 'Inicializar controles'}</button>}<small>Montos en unidad mayor; se persisten como enteros en unidad mínima.</small></form> : <p className="card-empty-copy">La cuenta vinculada no está disponible para configurar controles.</p>}</section>
          <section><h3>Historial de ciclo de vida</h3><div className="card-timeline">{lifecycle.map((event) => <article key={event.id}><i /><div><strong>{event.fromStatus ? `${STATUS_LABELS[event.fromStatus]} → ` : ''}{STATUS_LABELS[event.toStatus]}</strong><span>{REASON_LABELS[event.reason] ?? event.reason} · {event.actorName}</span><small>{localizedDate(event.createdAt)}</small></div></article>)}</div></section></div>
      </> : <div className="card-empty"><strong>Seleccioná una tarjeta</strong><span>Acá vas a ver estados, controles e historial auditable.</span></div>}</article>
    </div>
    <div className="card-sandbox-boundary"><strong>Límite operativo honesto</strong><span>Este vertical demuestra contratos, persistencia, roles, idempotencia, auditoría y eventos. No almacena datos PCI ni procesa autorizaciones ISO 8583; eso requiere sponsor, procesador certificado, HSM, tokenización y certificaciones de red.</span></div>
  </div>;
}
