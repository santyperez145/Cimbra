import DemoForm from './demo-form';

const transactions = [
  { name: 'Mercado Uno', kind: 'QR interoperable', amount: '+ $ 82.450', status: 'Liquidado' },
  { name: 'Transferencia CVU', kind: 'Cuenta de origen', amount: '+ $ 210.000', status: 'Liquidado' },
  { name: 'Cloud Services', kind: 'Tarjeta corporativa', amount: '- USD 480', status: 'Autorizado' },
];

export default function Home() {
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
          <div className="nav-actions"><a className="nav-login" href="/login">Ingresar</a><a className="nav-cta" href="#demo">Hablemos <span aria-hidden="true">↗</span></a></div>
        </header>

        <div id="inicio" className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Infraestructura financiera para Latinoamérica</p>
            <h1>Tu producto financiero,<br /><em>sin construir el banco.</em></h1>
            <p className="hero-lede">
              Cuentas, pagos, tarjetas, crédito y compliance en una sola plataforma API-first. Modular para empezar. Robusta para escalar.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#demo">Diseñemos tu lanzamiento <span>↗</span></a>
              <a className="button button-secondary" href="#developers"><span className="code-icon">{'{ }'}</span> Ver documentación</a>
            </div>
            <div className="trust-row" aria-label="Características de confianza">
              <span><b>●</b> API unificada</span>
              <span><b>●</b> Ledger en tiempo real</span>
              <span><b>●</b> Arquitectura multi-país</span>
            </div>
          </div>

          <div className="console-wrap" aria-label="Vista previa de la consola Cimbra">
            <div className="float-chip float-chip-top"><span>Disponibilidad</span><strong><i /> 99,99%</strong></div>
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
                  <div><span className="env-pill">● Producción</span><b>FM</b></div>
                </div>
                <div className="console-content">
                  <div className="console-heading">
                    <div><small>BUEN DÍA, FINANZAS MODA</small><h2>Todo en orden.</h2></div>
                    <button aria-label="Más opciones">•••</button>
                  </div>
                  <div className="metric-grid">
                    <article className="metric-main">
                      <div><span>Volumen procesado</span><small>Últimos 30 días</small></div>
                      <strong>$ 18,4M</strong>
                      <div className="chart" aria-hidden="true">
                        {[38, 52, 44, 66, 58, 81, 72, 93, 84, 100].map((h, i) => <i key={i} style={{height: `${h}%`}} />)}
                      </div>
                      <small className="metric-up">↗ 18,2% vs. período anterior</small>
                    </article>
                    <article className="metric-side"><span>Tasa de aprobación</span><strong>96,8%</strong><small>↗ 1,4%</small></article>
                    <article className="metric-side coral"><span>Alertas de riesgo</span><strong>03</strong><small>Requieren revisión</small></article>
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
            <div className="float-chip float-chip-bottom"><span>Procesado hoy</span><strong>$ 2.847.230 <i>↗ 12%</i></strong></div>
          </div>
        </div>

        <div className="hero-foot">
          <p>Un solo contrato. Una sola integración.<br />Todo el stack financiero.</p>
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
          <article className="module-card featured"><span className="module-number">01</span><div className="module-icon">⌗</div><h3>Core & Ledger</h3><p>Cuentas multi-moneda, ledger de doble partida, saldos disponibles y contables, intereses y límites.</p><ul><li>CVU / CBU / CLABE</li><li>Conciliación en tiempo real</li><li>Multi-entidad y multi-país</li></ul><a href="#demo">Explorar módulo →</a></article>
          <article className="module-card"><span className="module-number">02</span><div className="module-icon">↔</div><h3>Payments</h3><p>Pagos, cobros y payouts orquestados a través de rieles locales desde una API consistente.</p><ul><li>Transferencias y QR</li><li>Servicios y recargas</li><li>Split payments</li></ul><a href="#demo">Explorar módulo →</a></article>
          <article className="module-card"><span className="module-number">03</span><div className="module-icon">▰</div><h3>Cards</h3><p>Emisión y procesamiento de débito, crédito y prepago, físicas o virtuales, con controles en tiempo real.</p><ul><li>Tokenización y 3DS</li><li>Controles configurables</li><li>Disputas y chargebacks</li></ul><a href="#demo">Explorar módulo →</a></article>
          <article className="module-card"><span className="module-number">04</span><div className="module-icon">◒</div><h3>Lending</h3><p>Originación, scoring, desembolso y servicing para crédito al consumo, comercios y capital de trabajo.</p><ul><li>Motor de decisiones</li><li>Calendarios flexibles</li><li>Cobranzas automatizadas</li></ul><a href="#demo">Explorar módulo →</a></article>
          <article className="module-card"><span className="module-number">05</span><div className="module-icon">✓</div><h3>Compliance & Risk</h3><p>Onboarding KYB/KYC, reglas AML, monitoreo transaccional y expedientes auditables por jurisdicción.</p><ul><li>Screening PEP y sanciones</li><li>Rules engine</li><li>Case management</li></ul><a href="#demo">Explorar módulo →</a></article>
          <article className="module-card"><span className="module-number">06</span><div className="module-icon">⌁</div><h3>Data & Operations</h3><p>Consola unificada, webhooks, reportes regulatorios, conciliación y observabilidad del ciclo completo.</p><ul><li>Eventos en tiempo real</li><li>Exports y reportes</li><li>Roles y trazabilidad</li></ul><a href="#demo">Explorar módulo →</a></article>
        </div>
      </section>

      <section id="soluciones" className="orchestration-section">
        <div className="orchestration-copy">
          <p className="eyebrow"><span /> ORQUESTACIÓN REGIONAL</p>
          <h2>Una integración.<br />Múltiples rieles.<br /><em>Cero callejones.</em></h2>
          <p>Cimbra desacopla tu producto de bancos, procesadores y proveedores locales. Enrutamos cada operación por disponibilidad, costo, riesgo y regulación.</p>
          <div className="check-list"><span><b>✓</b> Failover y reintentos idempotentes</span><span><b>✓</b> Ledger neutral respecto del proveedor</span><span><b>✓</b> Migración gradual, sin big bang</span></div>
          <a className="text-link" href="#demo">Diseñar mi arquitectura →</a>
        </div>
        <div className="rail-map" aria-label="Arquitectura modular Cimbra">
          <div className="rail-column providers"><small>CANALES</small><span>APP</span><span>WEB</span><span>POS</span><span>API</span></div>
          <div className="rail-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="rail-core"><span className="brand-mark"><i /><i /><i /></span><strong>CIMBRA</strong><small>ORCHESTRATION LAYER</small><div><b>Identity</b><b>Ledger</b><b>Risk</b><b>Routing</b></div></div>
          <div className="rail-lines right" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="rail-column destinations"><small>RIELES</small><span>BANK</span><span>CARD</span><span>QR</span><span>BILL</span></div>
          <div className="rail-status"><i /> Enrutamiento operativo <b>24/7</b></div>
        </div>
      </section>

      <section id="developers" className="developer-section">
        <div className="code-window">
          <div className="code-top"><span><i /><i /><i /></span><b>create-transfer.ts</b><small>Node.js</small></div>
          <pre><code><span className="code-muted">{'// Una llamada. Idempotencia incluida.'}</span>{'\n'}<span className="code-pink">const</span> transfer = <span className="code-pink">await</span> fetch(<span className="code-yellow">&quot;/api/sandbox/transfers&quot;</span>, {'{'}{'\n'}  <span className="code-blue">method</span>: <span className="code-yellow">&quot;POST&quot;</span>,{'\n'}  <span className="code-blue">headers</span>: {'{'}{'\n'}    <span className="code-yellow">&quot;Content-Type&quot;</span>: <span className="code-yellow">&quot;application/json&quot;</span>,{'\n'}    <span className="code-yellow">&quot;Idempotency-Key&quot;</span>: crypto.randomUUID(){'\n'}  {'}'},{'\n'}  <span className="code-blue">body</span>: JSON.stringify({'{'}{'\n'}    <span className="code-blue">amount</span>: <span className="code-green">250000</span>,{'\n'}    <span className="code-blue">currency</span>: <span className="code-yellow">&quot;ARS&quot;</span>,{'\n'}    <span className="code-blue">counterparty</span>: <span className="code-yellow">&quot;Proveedor Andino&quot;</span>,{'\n'}    <span className="code-blue">description</span>: <span className="code-yellow">&quot;Pago de servicios&quot;</span>{'\n'}  {'}'}){'\n'}{'}'});</code></pre>
          <div className="code-response"><span>201 CREATED</span><code>{'{ "id": "trf_3x9…", "status": "settled" }'}</code></div>
        </div>
        <div className="developer-copy"><p className="eyebrow"><span /> DEVELOPER FIRST, DE VERDAD</p><h2>Una API que tu equipo va a querer usar.</h2><p>Recursos consistentes, SDKs tipados, sandbox con datos realistas y webhooks firmados. Diseñada para integrar en días y operar durante años.</p><div className="developer-stats"><div><strong>&lt; 10 min</strong><span>primer request</span></div><div><strong>99,99%</strong><span>SLA objetivo enterprise</span></div><div><strong>24/7</strong><span>observabilidad y soporte</span></div></div><a className="button button-coral" href="/developers">Abrir documentación <span>↗</span></a></div>
      </section>

      <section id="empresa" className="principles-section">
        <div className="section-heading"><p className="eyebrow"><span /> CONSTRUIDA PARA INFRAESTRUCTURA CRÍTICA</p><h2>Velocidad sin deuda operativa.</h2><p>Cada decisión técnica reduce riesgo, acelera integración y mantiene la trazabilidad que exige el sistema financiero.</p></div>
        <div className="principles-grid"><article><span>01</span><h3>Seguridad por diseño</h3><p>Cifrado, segregación de funciones, mínimo privilegio y auditoría inmutable como base, no como add-on.</p></article><article><span>02</span><h3>Control sin lock-in</h3><p>Modelos de datos portables, contratos claros y capas desacopladas para que el cliente conserve el control.</p></article><article><span>03</span><h3>Operación observable</h3><p>Métricas, logs y trazas desde el request hasta la conciliación. Lo que mueve dinero nunca es una caja negra.</p></article><article><span>04</span><h3>Compliance local</h3><p>Políticas configurables por producto y país, con evidencia, versionado y revisión humana cuando corresponde.</p></article></div>
      </section>

      <section className="launch-section">
        <div className="launch-heading"><p className="eyebrow"><span /> DEL DISEÑO A PRODUCCIÓN</p><h2>Lanzá por etapas.<br />Escalá sin rehacer.</h2></div>
        <ol className="launch-steps"><li><span>01</span><div><small>SEMANA 1</small><h3>Descubrimiento</h3><p>Producto, jurisdicción, riesgos, unit economics y mapa de proveedores.</p></div></li><li><span>02</span><div><small>SEMANA 2–4</small><h3>Sandbox</h3><p>APIs, journeys, eventos, reglas y validación técnica con tu equipo.</p></div></li><li><span>03</span><div><small>SEMANA 5–8</small><h3>Homologación</h3><p>Integraciones, seguridad, compliance, conciliación y pruebas de carga.</p></div></li><li><span>04</span><div><small>GO LIVE</small><h3>Producción</h3><p>Rollout controlado, observabilidad, soporte y mejora continua.</p></div></li></ol>
      </section>

      <section id="demo" className="demo-section">
        <div className="demo-copy"><p className="eyebrow"><span /> EMPECEMOS</p><h2>La infraestructura no debería frenar tu próximo producto.</h2><p>Contanos qué querés construir. Te devolvemos un mapa de producto, integración y salida a mercado.</p><div className="demo-note"><strong>Primera sesión · 45 minutos</strong><span>Sin pitch genérico. Con producto y arquitectura.</span></div></div>
        <DemoForm />
      </section>

      <footer className="site-footer"><div className="footer-top"><a className="brand footer-brand" href="#inicio"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></a><p>Infraestructura financiera<br />para Latinoamérica.</p><div className="footer-status"><i /> Todos los sistemas operativos</div></div><div className="footer-links"><div><strong>Plataforma</strong><a href="#plataforma">Core & Ledger</a><a href="#plataforma">Payments</a><a href="#plataforma">Cards</a><a href="#plataforma">Lending</a></div><div><strong>Recursos</strong><a href="/developers">Documentación</a><a href="/console">Sandbox</a><a href="/api/health">Status API</a><a href="#empresa">Seguridad</a></div><div><strong>Compañía</strong><a href="#empresa">Nosotros</a><a href="#demo">Contacto</a><a href="#demo">Partners</a><a href="#demo">Carreras</a></div><div><strong>Regiones</strong><span>Argentina · México</span><span>Colombia · Brasil</span><span>Chile · Perú</span></div></div><div className="footer-bottom"><span>© 2026 Cimbra Technologies. Todos los derechos reservados.</span><div><a href="#demo">Privacidad</a><a href="#demo">Términos</a><a href="#demo">Seguridad</a></div></div></footer>
    </main>
  );
}
