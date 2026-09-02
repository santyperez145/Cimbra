import Link from 'next/link';
import DemoForm from '../demo-form';
import { buildInvestorEvidence } from '@/app/lib/platform/investor-evidence';
import { evaluateLiveReadiness } from '@/app/lib/platform/live-readiness';
import { loadApiReference } from '@/app/lib/platform/openapi-reference';

export const metadata = {
  title: 'Inversores — Cimbra',
  description: 'Data room público de Cimbra: evidencia de producto sandbox, presupuesto de USD 500 para Gate 1 y camino PSPCP fail-closed. Sin tracción inventada.',
};

export const dynamic = 'force-dynamic';

function money(amount: number) {
  return `USD ${amount}`;
}

export default function InvestorsPage() {
  const reference = loadApiReference();
  const evidence = buildInvestorEvidence(evaluateLiveReadiness(), reference.operations.length);
  const capital = evidence.capital;
  const production = evidence.environments.find((item) => item.id === 'production');

  return <main className="investor-shell">
    <header>
      <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link>
      <nav>
        <Link href="/developers">Developers</Link>
        <Link href="/#demo">Contacto</Link>
      </nav>
    </header>
    <article>
      <p className="eyebrow"><span /> DATA ROOM PÚBLICO · PRE-SEED</p>
      <h1>Producto real.<br /><em>Dinero todavía no.</em></h1>
      <p className="investor-lede">Cimbra es infraestructura financiera propia para Latinoamérica. El sandbox ejecuta ledger, API y consola. Live permanece fail-closed: no hay hostname de producción, inscripción PSP, banco patrocinante ni Coelsa. USD 500 no cambia eso; sí compra Gate 1.</p>

      <div className="investor-proof" aria-label="Evidencia verificable">
        <article><strong>{evidence.liveReady ? 'Sí' : 'No'}</strong><span>listo para dinero real</span></article>
        <article><strong>{evidence.product.openApiOperations}</strong><span>operaciones OpenAPI</span></article>
        <article><strong>{evidence.product.capabilities.sandbox}</strong><span>dominios sandbox</span></article>
        <article><strong>{`${evidence.product.fintechGatesMet}/${evidence.product.fintechGatesTotal}`}</strong><span>gates PSPCP</span></article>
        <article><strong>{money(capital.envelope)}</strong><span>presupuesto Gate 1</span></article>
        <article><strong>{evidence.traction.payingCustomers}</strong><span>clientes de pago</span></article>
      </div>
      <p className="investor-note">{evidence.traction.note} Host sandbox: {evidence.environments.find((item) => item.id === 'sandbox')?.hostname}. Production: {production?.hostname ?? 'sin hostname'}.</p>

      <section>
        <h2>Tesis</h2>
        <p>La oportunidad es una plataforma regional propia que elimine la fragmentación entre core, pagos, emisión, cobranzas, compliance y operación. Cimbra controla el producto, el ledger y la economía. BIND, Dock, tapi, Pismo, Pomelo y Wibond son benchmarks, nunca conectores. El primer riel real será un banco, cámara, esquema o sponsor regulado.</p>
      </section>

      <section>
        <h2>Qué existe hoy</h2>
        <p>Sandbox verificable con {evidence.product.openApiOperations} operaciones, {evidence.product.capabilities.total} dominios de catálogo ({evidence.product.capabilities.sandbox} ejecutables, {evidence.product.capabilities.roadmap} en roadmap) y {evidence.product.productsInIntegracion} productos públicos en Integración. Ninguno está en Go Live. {evidence.product.officialRailsLive} de {evidence.product.officialRailsTotal} rieles oficiales están live. El ledger de doble partida es la fuente de verdad; las correcciones son compensaciones.</p>
        <ul className="investor-list">
          {evidence.products.map((product) => (
            <li key={product.id}><strong>{product.name}</strong><span>Integración · {product.missingForProduction}</span></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>USD 500 — lo que este envelope compra</h2>
        <p>{capital.summary} Asignado {money(capital.allocated)}. Gastado {money(capital.spent)}. Remanente {money(capital.remaining)}.</p>
        <ul className="investor-list">
          {capital.allocations.map((item) => (
            <li key={item.id}><strong>{money(item.amount)} · {item.name}</strong><span>{item.summary}</span></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Lo que USD 500 no compra</h2>
        <ul className="investor-list investor-forbidden">
          {capital.forbidden.map((item) => (
            <li key={item.id}><strong>{item.name}</strong><span>{item.summary}</span></li>
          ))}
        </ul>
        <p>Fuentes: {capital.officialSources.map((source, index) => <span key={source.url}>{index > 0 ? ' · ' : ''}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></span>)}.</p>
      </section>

      <section>
        <h2>Camino PSPCP Argentina</h2>
        <p>{evidence.fintechPath.summary}</p>
        <ul className="investor-list">
          {evidence.fintechPath.gates.map((gate) => (
            <li key={gate.id}><strong>{gate.met ? 'Cumplido' : 'Pendiente'} · {gate.name}</strong><span>{gate.summary}</span></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Qué financia el próximo cheque</h2>
        <p>{capital.raise.thesis} Instrumento: pre-seed. Monto: no tasado.</p>
        <ul className="investor-list">
          {capital.seedUses.map((item) => <li key={item}><strong>{item}</strong></li>)}
        </ul>
      </section>

      <section id="contacto">
        <h2>Pedir el data room privado</h2>
        <p>El data room cerrado suma cap table, riesgos y presupuesto de 18 meses cuando existan. Hasta entonces esta página es la evidencia pública. Si sos inversor, dejá el contacto: no hay tracción que maquillar.</p>
        <DemoForm intent="investor" />
      </section>
    </article>
  </main>;
}
