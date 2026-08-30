import DemoForm from './demo-form';
import { getCurrentUser } from './lib/auth/session';
import { ROLE_PROFILES, type OrganizationRole } from './lib/platform/access-policy';

export const dynamic = 'force-dynamic';

const transactions = [
  { name: 'Mercado Uno', kind: 'QR interoperable', amount: '+ $ 82.450', status: 'Liquidado' },
  { name: 'Transferencia CVU', kind: 'Cuenta de origen', amount: '+ $ 210.000', status: 'Liquidado' },
  { name: 'Cloud Services', kind: 'Tarjeta corporativa', amount: '- USD 480', status: 'Autorizado' },
];

const roleCapabilities: Array<{ role: OrganizationRole; capabilities: string }> = [
  { role: 'owner', capabilities: 'Gobierno · políticas · credenciales · operación' },
  { role: 'admin', capabilities: 'Configuración delegada · equipo · operación' },
  { role: 'operator', capabilities: 'Movimientos · riesgo · conciliación · casos' },
  { role: 'viewer', capabilities: 'Lectura · evidencia · auditoría · exportación' },
];

export default async function Home() {
  const user = await getCurrentUser();
  const firstName = user?.displayName.trim().split(/\s+/)[0] ?? '';
  const primaryHref = user ? '/console' : '#demo';
  const primaryLabel = user ? 'Abrir mi consola' : 'Diseñemos tu lanzamiento';
  return (
    <main>
      <section className="hero-shell">
        <header className="site-nav" aria-label="Navegación principal">
          <a className="brand" href="#inicio" aria-label="Cimbra, inicio">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>CIMBRA</span>
          </a>
          <nav className="nav-links" aria-label="Secciones">
            <a href="#plataforma">Plataforma</a>
            <a href="#soluciones">Soluciones</a>
            <a href="#developers">Developers</a>
            <a href="#empresa">Empresa</a>
          </nav>
          <div className="nav-actions">{user ? <span className="session-chip"><i /> Sesión activa · {firstName}</span> : <a className="nav-login" href="/login?return_to=%2Fconsole">Ingresar</a>}<a className="nav-cta" href={user ? '/console' : '#demo'}>{user ? 'Abrir consola' : 'Hablemos'} <span aria-hidden="true">↗</span></a></div>
        </header>

        <div id="inicio" className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Infraestructura financiera para Latinoamérica</p>
            <h1>Infraestructura propia<br /><em>para operar finanzas.</em></h1>
            <p className="hero-lede">
              Core transaccional, payments sandbox, riesgo, conciliación, SDK y APIs versionadas en una sola capa operable. Construida para evolucionar hacia rieles directos sin depender de otra fintech.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={primaryHref}>{primaryLabel} <span>↗</span></a>
              <a className="button button-secondary" href="#developers"><span className="code-icon">{'{ }'}</span> Ver documentación</a>
            </div>
            <div className="trust-row" aria-label="Características de confianza">
              <span><b>●</b> Sandbox verificable</span>
              <span><b>●</b> Ledger de doble partida</span>
              <span><b>●</b> Aislamiento por tenant</span>
            </div>
          </div>

          <div className="console-wrap" aria-label="Vista previa de la consola Cimbra">
            <div className="float-chip float-chip-top"><span>Ledger</span><strong><i /> Partida doble</strong></div>
            <div className="console-card">
              <aside className="console-sidebar">
                <div className="mini-mark"><i /><i /><i /></div>
                {['⌂', '↔', '▰', '◎', '◇'].map((icon, index) => (
                  <span key={icon} className={index === 0 ? 'active' : ''}>{icon}</span>
                ))}
                <span className="sidebar-bottom">?</span>
              </aside>
              <div className="console-main">
                <div className="console-topbar">
                  <span>Vista general</span>
                  <div><span className="env-pill">● Sandbox</span><b>CS</b></div>
                </div>
                <div className="console-content">
                  <div className="console-heading">
                    <div><small>TENANT INICIAL CIMBRA</small><h2>Ledger balanceado.</h2></div>
                  </div>
                  <div className="metric-grid">
                    <article className="metric-main">
                      <div><span>Volumen ARS registrado</span><small>Datos semilla del sandbox</small></div>
                      <strong>$ 5.420.950</strong>
                      <small className="metric-up">8 movimientos persistidos</small>
                    </article>
                    <article className="metric-side"><span>Tasa de aprobación</span><strong>75,0%</strong><small>Calculada por estado</small></article>
                    <article className="metric-side coral"><span>Reservas activas</span><strong>02</strong><small>Requieren decisión</small></article>
                  </div>
                  <div className="activity">
                    <div className="activity-title"><strong>Actividad reciente</strong><span>Ver todas →</span></div>
                    {transactions.map((transaction, index) => (
                      <div className="transaction" key={transaction.name}>
                        <span className={`transaction-icon t${index}`}>{index === 2 ? '▰' : '↗'}</span>
                        <div><strong>{transaction.name}</strong><small>{transaction.kind}</small></div>
                        <strong>{transaction.amount}</strong><span className="status"><i />{transaction.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="float-chip float-chip-bottom"><span>Balances separados</span><strong>ARS · USD</strong></div>
          </div>
        </div>

        <div className="proof-strip" aria-label="Controles comprobables del sandbox">
          <div className="proof-intro"><span><i /> SANDBOX OPERATIVO</span><strong>La base técnica ya se puede probar.</strong></div>
          <article><small>01 · CONTRATO</small><b>API v1 + OpenAPI</b><span>SDK TypeScript generado y scopes por recurso.</span></article>
          <article><small>02 · DINERO</small><b>Ledger inmutable</b><span>Partida doble, holds, reversas y monedas segregadas.</span></article>
          <article><small>03 · CONTROL</small><b>RBAC + 4-eyes</b><span>Permisos por rol y maker/checker para acciones sensibles.</span></article>
          <article><small>04 · EVENTOS</small><b>Webhooks firmados</b><span>Outbox durable, HMAC, reintentos y replay auditado.</span></article>
        </div>

        <div className="hero-foot">
          <p>Producto propio. Integración modular.<br />Disponibilidad y límites publicados sin ambigüedad.</p>
          <div className="country-list"><span>AR</span><span>MX</span><span>CO</span><span>BR</span><span>CL</span><span>PE</span></div>
        </div>
      </section>

      <section id="plataforma" className="platform-section">
        <div className="section-heading light">
          <p className="eyebrow"><span /> PLATAFORMA MODULAR</p>
          <h2>Una base. Todos los productos<br />que tu negocio necesita.</h2>
          <p>Activá sólo lo que necesitás hoy. Sumá nuevas capacidades sin migraciones traumáticas ni integraciones duplicadas.</p>
        </div>
        <div className="module-grid">
          <article className="module-card featured"><span className="module-number">01 · DISPONIBLE</span><div className="module-icon">⌗</div><h3>Core & Ledger</h3><p>Cuentas multi-moneda, journals de doble partida, saldos disponibles y contables, holds y reversas.</p><ul><li>Montos BIGINT en unidad mínima</li><li>Postings inmutables</li><li>Idempotencia por tenant</li></ul><a href="/console">Probar en sandbox →</a></article>
          <article className="module-card"><span className="module-number">02 · SANDBOX</span><div className="module-icon">↔</div><h3>Payments & Services</h3><p>Transferencias, catálogo de servicios, deuda emitida, recargas y mandatos sobre un único ledger y motor de riesgo.</p><ul><li>Pagos y recargas idempotentes</li><li>Consentimiento, holds y reversas</li><li>Sin cobertura ni fondos reales</li></ul><a href="/developers#billers">Ver API →</a></article>
          <article className="module-card"><span className="module-number">03 · SANDBOX</span><div className="module-icon">▰</div><h3>Cards</h3><p>Recursos de tarjeta de prueba vinculados a customers y cuentas de la organización.</p><ul><li>Débito, crédito y prepago</li><li>Formato virtual o físico</li><li>Sin conexión a una red</li></ul><a href="/developers">Ver API →</a></article>
          <article className="module-card"><span className="module-number">04 · ROADMAP</span><div className="module-icon">◒</div><h3>Lending</h3><p>Dominio previsto para originación, decisiones, calendarios, desembolso y servicing.</p><ul><li>No habilitado aún</li><li>Requiere modelo de riesgo</li><li>Requiere marco regulatorio</li></ul><a href="#demo">Diseñar módulo →</a></article>
          <article className="module-card"><span className="module-number">05 · RISK DISPONIBLE</span><div className="module-icon">✓</div><h3>Risk, KYC & Reconciliation</h3><p>Reglas, score explicable, KYC/KYB orquestado, casos, holds y conciliación; las fuentes oficiales permanecen fuera del sandbox.</p><ul><li>Rules engine y velocity</li><li>Expedientes y decisiones auditables</li><li>Excepciones de conciliación</li></ul><a href="/console">Abrir operaciones →</a></article>
          <article className="module-card"><span className="module-number">06 · OPERATIVO</span><div className="module-icon">⌁</div><h3>Data & Operations</h3><p>Consola unificada, credenciales S2S y webhooks firmados sobre una cola durable con replay.</p><ul><li>API keys con scopes</li><li>Outbox y reintentos</li><li>Logs por intento</li></ul><a href="/developers">Abrir documentación →</a></article>
        </div>
      </section>

      <section id="soluciones" className="buyer-section">
        <div className="buyer-heading">
          <p className="eyebrow"><span /> INFRAESTRUCTURA PARA QUIENES CONSTRUYEN</p>
          <h2>Una plataforma.<br />Cuatro modelos de negocio.</h2>
          <p>Cimbra desacopla producto, operación y rieles para que cada equipo active sólo los dominios que necesita y conserve una fuente de verdad común.</p>
        </div>
        <div className="buyer-grid">
          <article><span>01</span><h3>Fintechs y wallets</h3><p>Cuentas, transferencias, tarjetas sandbox y controles operativos sobre un ledger propio.</p><b>CORE · PAYMENTS · CARDS</b></article>
          <article><span>02</span><h3>Marketplaces</h3><p>Saldos segregados, payouts, conciliación y doble aprobación para tesorería de plataforma.</p><b>LEDGER · RISK · PAYOUTS</b></article>
          <article><span>03</span><h3>SaaS vertical</h3><p>Capacidades financieras embebidas mediante API, SDK y eventos sin reconstruir el backoffice.</p><b>API · SDK · WEBHOOKS</b></article>
          <article><span>04</span><h3>Operaciones enterprise</h3><p>Gobierno por rol, evidencia, casos, conciliación y trazabilidad de cada decisión sensible.</p><b>RBAC · 4-EYES · AUDIT</b></article>
        </div>
      </section>

      <section id="arquitectura" className="orchestration-section">
        <div className="orchestration-copy">
          <p className="eyebrow"><span /> ORQUESTACIÓN REGIONAL</p>
          <h2>Una integración.<br />Múltiples rieles.<br /><em>Cero callejones.</em></h2>
          <p>La arquitectura desacopla el dominio financiero de bancos, cámaras, esquemas y sponsors regulados. Cimbra es la capa de producto y operación; cada conexión real será directa, certificada y reemplazable.</p>
          <div className="check-list"><span><b>✓</b> Dominio, ledger e idempotencia propios</span><span><b>✓</b> Contratos canónicos sin dependencia de competidores</span><span><b>→</b> Adaptadores directos, routing y failover por homologar</span></div>
          <a className="text-link" href="#demo">Diseñar mi arquitectura →</a>
        </div>
        <div className="rail-map" aria-label="Arquitectura modular Cimbra">
          <div className="rail-column providers"><small>CANALES</small><span>APP</span><span>WEB</span><span>POS</span><span>API</span></div>
          <div className="rail-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="rail-core"><span className="brand-mark"><i /><i /><i /></span><strong>CIMBRA</strong><small>ORCHESTRATION LAYER</small><div><b>Identity</b><b>Ledger</b><b>Risk</b><b>Routing</b></div></div>
          <div className="rail-lines right" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="rail-column destinations"><small>RIELES</small><span>BANK</span><span>CARD</span><span>QR</span><span>BILL</span></div>
          <div className="rail-status"><i /> Perímetro preparado <b>DIRECT-RAIL READY</b></div>
        </div>
      </section>

      <section id="developers" className="developer-section">
        <div className="code-window">
          <div className="code-top"><span><i /><i /><i /></span><b>create-transfer.ts</b><small>Node.js</small></div>
          <pre><code><span className="code-muted">{'// SDK tipado. Idempotencia y request ID incluidos.'}</span>{'\n'}<span className="code-pink">const</span> cimbra = <span className="code-pink">new</span> Cimbra({'{'} <span className="code-blue">apiKey</span>: process.env.CIMBRA_API_KEY {'}'});{'\n'}<span className="code-pink">const</span> transfer = <span className="code-pink">await</span> cimbra.transfers.create({'{'}{'\n'}  <span className="code-blue">amount</span>: <span className="code-yellow">&quot;250000.00&quot;</span>,{'\n'}  <span className="code-blue">currency</span>: <span className="code-yellow">&quot;ARS&quot;</span>,{'\n'}  <span className="code-blue">counterparty</span>: <span className="code-yellow">&quot;Proveedor Andino&quot;</span>,{'\n'}  <span className="code-blue">description</span>: <span className="code-yellow">&quot;Pago de servicios&quot;</span>{'\n'}{'}'});</code></pre>
          <div className="code-response"><span>201 / 202</span><code>{'{ "transaction": { "id": "<uuid>" }, "requiresApproval": true, "replayed": false }'}</code></div>
        </div>
        <div className="developer-copy"><p className="eyebrow"><span /> DEVELOPER FIRST, DE VERDAD</p><h2>Una API verificable desde el primer request.</h2><p>Contrato OpenAPI, SDK tipado, recursos persistentes, scopes por credencial, request IDs e idempotencia obligatoria en movimientos financieros.</p><div className="developer-stats"><div><strong>OpenAPI</strong><span>contrato público</span></div><div><strong>PostgreSQL</strong><span>fuente de verdad</span></div><div><strong>Reversas</strong><span>sin mutar postings</span></div></div><a className="button button-coral" href="/developers">Abrir documentación <span>↗</span></a></div>
      </section>

      <section id="empresa" className="principles-section">
        <div className="section-heading"><p className="eyebrow"><span /> CONSTRUIDA PARA INFRAESTRUCTURA CRÍTICA</p><h2>Velocidad sin deuda operativa.</h2><p>Cada decisión técnica reduce riesgo, acelera integración y mantiene la trazabilidad que exige el sistema financiero.</p></div>
        <div className="principles-grid"><article><span>01</span><h3>Seguridad por diseño</h3><p>Sesiones opacas, API keys hasheadas, scopes, secretos cifrados y auditoría persistida desde el primer release.</p></article><article><span>02</span><h3>Control sin lock-in</h3><p>PostgreSQL estándar, modelos portables y dominio desacoplado para que el cliente conserve el control.</p></article><article><span>03</span><h3>Operación verificable</h3><p>Healthcheck real, outbox transaccional, webhooks firmados y estados explícitos desde el request hasta el journal.</p></article><article><span>04</span><h3>Compliance progresivo</h3><p>Evidencia privada y trazabilidad hoy; screening, case management y controles jurisdiccionales en roadmap.</p></article></div>
      </section>

      <section className="access-story-section">
        <div className="access-story-heading">
          <div><p className="eyebrow"><span /> CONTROL DE ACCESO REAL</p><h2>Cada persona ve y ejecuta sólo lo que le corresponde.</h2></div>
          <p>Una política canónica gobierna API y consola. Las acciones no autorizadas no se decoran ni se simulan: se ocultan cuando no aplican y el servidor las vuelve a validar.</p>
        </div>
        <div className="role-story-grid">
          {roleCapabilities.map(({ role, capabilities }) => <article key={role}><div><span>{ROLE_PROFILES[role].label}</span><b>{ROLE_PROFILES[role].posture}</b></div><p>{ROLE_PROFILES[role].description}</p><small>{capabilities}</small></article>)}
        </div>
        <div className="auth-boundary">
          <div><span>01</span><b>Sin sesión</b><p>Landing, documentación y acceso. La consola redirige a login conservando el destino.</p></div>
          <i aria-hidden="true">→</i>
          <div><span>02</span><b>Sesión válida</b><p>Tenant y rol efectivos resueltos en el servidor antes de cargar datos privados.</p></div>
          <i aria-hidden="true">→</i>
          <div><span>03</span><b>Capacidad autorizada</b><p>RBAC para humanos, scopes para API keys y MFA en decisiones privilegiadas.</p></div>
        </div>
      </section>

      <section className="launch-section">
        <div className="launch-heading"><p className="eyebrow"><span /> DEL DISEÑO A PRODUCCIÓN</p><h2>Lanzá por etapas.<br />Escalá sin rehacer.</h2></div>
        <ol className="launch-steps"><li><span>01</span><div><small>GATE 0 · FIT</small><h3>Descubrimiento</h3><p>Producto, jurisdicción, riesgos, unit economics y mapa de rieles directos.</p></div></li><li><span>02</span><div><small>GATE 1 · BUILD</small><h3>Sandbox</h3><p>APIs, journeys, eventos, reglas y validación técnica con tu equipo.</p></div></li><li><span>03</span><div><small>GATE 2 · PROVE</small><h3>Homologación</h3><p>Licencias, sponsors, seguridad, conciliación, resiliencia y pruebas de carga.</p></div></li><li><span>04</span><div><small>GATE 3 · OPERATE</small><h3>Producción</h3><p>Go-live sólo con riel, contrato, certificación, SLO y runbooks comprobados.</p></div></li></ol>
      </section>

      <section id="demo" className="demo-section">
        <div className="demo-copy"><p className="eyebrow"><span /> EMPECEMOS</p><h2>La infraestructura no debería frenar tu próximo producto.</h2><p>Contanos qué querés construir. Te devolvemos un mapa de producto, integración y salida a mercado.</p><div className="demo-note"><strong>Primera sesión · 45 minutos</strong><span>Sin pitch genérico. Con producto y arquitectura.</span></div></div>
        <DemoForm />
      </section>

      <footer className="site-footer"><div className="footer-top"><a className="brand footer-brand" href="#inicio"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></a><p>Infraestructura financiera<br />para Latinoamérica.</p><a className="footer-status" href="/api/health"><i /> Healthcheck público</a></div><div className="footer-links"><div><strong>Disponible</strong><a href="#plataforma">Core & Ledger</a><a href="#plataforma">Payments & Services</a><a href="#plataforma">Cards sandbox</a><a href="#plataforma">Risk & KYC/KYB</a></div><div><strong>Recursos</strong><a href="/developers">Documentación</a><a href="/console">Sandbox</a><a href="/openapi.yaml">OpenAPI</a><a href="/api/health">Status API</a></div><div><strong>Compañía</strong><a href="#empresa">Principios</a><a href="#demo">Contacto</a><a href="/terms">Términos</a><a href="/privacy">Privacidad</a></div><div><strong>Mercados objetivo</strong><span>Argentina · México</span><span>Colombia · Brasil</span><span>Chile · Perú</span></div></div><div className="footer-bottom"><span>© 2026 Cimbra Technologies. Todos los derechos reservados.</span><span>Sandbox tecnológico · No mueve fondos reales</span></div></footer>
    </main>
  );
}
