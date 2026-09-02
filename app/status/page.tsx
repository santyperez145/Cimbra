import Link from 'next/link';
import { evaluateLiveReadiness } from '@/app/lib/platform/live-readiness';
import { serviceTopology } from '@/app/lib/platform/service-catalog';
import { STATUS_SURFACES } from '@/app/lib/platform/help-center';

export const metadata = {
  title: 'Status — Cimbra',
  description: 'Estado público del sandbox Cimbra: modo efectivo, gates PSPCP, rieles oficiales y topología. Sin uptime inventado.',
};

export const dynamic = 'force-dynamic';

const railLabels: Record<string, string> = {
  unwired: 'Sin cablear',
  negotiating: 'Negociando',
  contracted: 'Contrato',
  certified: 'Certificado',
  live: 'Live',
};

export default function StatusPage() {
  const readiness = evaluateLiveReadiness();
  const topology = serviceTopology();
  const production = readiness.environments.find((item) => item.id === 'production');
  const sponsor = readiness.rails.find((rail) => rail.id === 'sponsor_bank');

  return <main className="investor-shell">
    <header>
      <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link>
      <nav>
        <Link href="/help">Ayuda</Link>
        <Link href="/developers">Developers</Link>
        <Link href="/api/health">Health JSON</Link>
      </nav>
    </header>
    <article>
      <p className="eyebrow"><span /> STATUS PÚBLICO</p>
      <h1>Sandbox operativo.<br /><em>Live cerrado.</em></h1>
      <p className="investor-lede">Esta página lee el mismo evaluador fail-closed que la API. No hay statuspage de terceros ni SLO contractual. El healthcheck JSON está en <Link href="/api/health">/api/health</Link>.</p>
      <div className="investor-proof" aria-label="Estado verificable">
        <article><strong>{readiness.effectiveMode}</strong><span>modo efectivo</span></article>
        <article><strong>{readiness.liveReady ? 'Sí' : 'No'}</strong><span>listo para dinero real</span></article>
        <article><strong>{readiness.fintechPath.metCount}/{readiness.fintechPath.gateCount}</strong><span>gates PSPCP</span></article>
        <article><strong>{readiness.summary.officialRailsLive}/{readiness.summary.officialRailsTotal}</strong><span>rieles live</span></article>
        <article><strong>{topology.totals.services}</strong><span>servicios de dominio</span></article>
        <article><strong>{production?.hostname ?? 'sin hostname'}</strong><span>production</span></article>
      </div>
      {readiness.blockReason && <p className="investor-note">Bloqueo live: {readiness.blockReason}</p>}
      <p className="investor-note">{topology.posture}</p>
      <section>
        <h2>Camino PSPCP</h2>
        <ul className="investor-list">
          {readiness.fintechPath.gates.map((gate) => (
            <li key={gate.id}>
              <strong>{gate.met ? 'Cumple' : 'Pendiente'} · {gate.name}</strong>
              <span>{railLabels[gate.status] ?? gate.status} · {gate.summary}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Rieles oficiales</h2>
        <ul className="investor-list">
          {readiness.rails.map((rail) => (
            <li key={rail.id}>
              <strong>{rail.name}</strong>
              <span>{railLabels[rail.status] ?? rail.status} · {rail.counterparty}{rail.adapterRegistered ? ' · adaptador listo' : ''}</span>
            </li>
          ))}
        </ul>
        {sponsor && <p className="investor-note">Banco patrocinante: {sponsor.status}. La evidencia se opera en /ops; BIND Banco puede ser candidato regulado, bindX no es el core.</p>}
      </section>
      <section>
        <h2>Servicios de dominio</h2>
        <ul className="investor-list">
          {topology.services.map((service) => (
            <li key={service.id}>
              <strong>{service.name}</strong>
              <span>{service.extractable ? 'Extraíble' : `${service.extractionDebt.length} escrituras cruzadas`} · {service.ownedTables} tablas · runtime {service.runtime === 'in_process' ? 'compartido' : 'propio'}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="investor-note">También: {STATUS_SURFACES.map((surface, index) => <span key={surface.id}>{index > 0 ? ' · ' : ''}<Link href={surface.href}>{surface.name}</Link></span>)}.</p>
    </article>
  </main>;
}
