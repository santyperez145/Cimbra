import Link from 'next/link';
import { notFound } from 'next/navigation';
import { retrievePublicPaymentLink } from '@/db/collections';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS_LABELS: Record<string, string> = {
  open: 'Pendiente',
  pending: 'En revisión',
  paid: 'Cobrado',
  expired: 'Vencido',
  cancelled: 'Cancelado',
  refunded: 'Devuelto',
};

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

export const dynamic = 'force-dynamic';

export default async function PublicPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const link = await retrievePublicPaymentLink(id);
  if (!link) notFound();
  const showsQr = link.allowedMethods.includes('cimbra_qr') && Boolean(link.qrPayload);
  const showsCvu = link.allowedMethods.includes('cimbra_cvu') && Boolean(link.cvu);

  return <main className="legal-shell checkout-shell">
    <header>
      <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link>
      <span>Checkout sandbox</span>
    </header>
    <article>
      <p className="eyebrow"><span /> COBRO · SANDBOX</p>
      <h1>{link.description}</h1>
      <p className="legal-updated">{link.customerName} · {link.externalReference}</p>
      <section>
        <h2>Importe</h2>
        <p>Total {money(link.amount)}. Cobrado {money(link.collectedAmount)}. Restante {money(link.remainingAmount)}. Devuelto {money(link.refundedAmount)}. Estado: {STATUS_LABELS[link.status] ?? link.status}{link.partiallyCollected ? ' · cobro parcial' : ''}{link.partiallyRefunded ? ' · devolución parcial' : ''}.</p>
      </section>
      {link.items.length > 0 && <section>
        <h2>Detalle</h2>
        {link.items.map((item) => <p key={`${item.description}-${item.amountMinor}`}>{item.quantity} × {item.description} · {money(item.amount)}{item.code ? ` · ${item.code}` : ''}</p>)}
        <p>El detalle es informativo: no cambia el monto a cobrar ni sustituye un carrito de adquirente.</p>
      </section>}
      {link.credits.length > 0 && <section>
        <h2>Créditos al CVU</h2>
        {link.credits.map((credit) => <p key={credit.id}>{money(credit.amount)} · {credit.method}{credit.refundedAmount > 0 ? ` · devuelto ${money(credit.refundedAmount)}` : ''} · {credit.createdAt.slice(0, 10)}</p>)}
      </section>}
      {link.refunds.length > 0 && <section>
        <h2>Devoluciones</h2>
        {link.refunds.map((refund) => <p key={refund.id}>{money(refund.amount)} · {refund.createdAt.slice(0, 10)}</p>)}
      </section>}
      {showsQr && <section>
        <h2>QR Cimbra</h2>
        <p>El pagador liquida la deuda asociada con el payload <code>{link.qrPayload}</code>. El monto del QR es cerrado.</p>
      </section>}
      {showsCvu && <section>
        <h2>Transferencia al CVU</h2>
        <p>CVU sandbox del punto de recaudación: <code>{link.cvu}</code>. Se puede acreditar en parciales, en varios créditos o por más del restante. Un inbound suelto al till no imputa este link.</p>
      </section>}
      <section>
        <h2>Qué no es esta página</h2>
        <p>No es un checkout de tarjeta, POS ni QR interoperable. No hay formulario PCI, <code>successUrl</code> ni <code>errorUrl</code> de adquirente. El UUID del link es el secreto de esta pantalla.</p>
      </section>
    </article>
  </main>;
}
