import Link from 'next/link';

const resources = [
  ['GET', '/api/v1/capabilities', 'Consultar servicios propios y disponibilidad real'],
  ['POST', '/api/v1/customers', 'Crear una persona o empresa'],
  ['POST', '/api/v1/accounts', 'Abrir una cuenta financiera'],
  ['POST', '/api/v1/cards', 'Emitir una tarjeta'],
  ['POST', '/api/v1/transfers', 'Crear o solicitar aprobación para una transferencia idempotente'],
  ['POST', '/api/v1/payments', 'Crear cash-in o cash-out sobre una cuenta'],
  ['POST', '/api/v1/risk/evaluations', 'Evaluar riesgo con score y razones persistidas'],
  ['POST', '/api/v1/risk/rules', 'Crear una regla de riesgo por tenant'],
  ['POST', '/api/v1/reconciliation/runs', 'Conciliar un lote contra movimientos Cimbra'],
  ['POST', '/api/v1/reconciliation/imports', 'Importar un CSV canónico con checksum'],
  ['POST', '/api/v1/reconciliation/exceptions/{id}/resolve', 'Resolver una diferencia auditable'],
  ['POST', '/api/v1/settlements', 'Crear o programar un ciclo sandbox'],
  ['POST', '/api/v1/settlements/{id}/execute', 'Ejecutar un settlement sandbox idempotente'],
  ['GET', '/api/v1/approvals', 'Listar solicitudes de aprobación y su historial'],
  ['POST', '/api/v1/approvals/{id}/approve', 'Aprobar y ejecutar como checker independiente con MFA'],
  ['POST', '/api/v1/transfers/{id}/reverse', 'Revertir mediante un asiento compensatorio'],
  ['GET', '/api/v1/ledger', 'Consultar balances, journals y reservas'],
  ['POST', '/api/v1/holds/{id}/capture', 'Capturar una reserva activa'],
  ['POST', '/api/v1/holds/{id}/release', 'Liberar una reserva activa'],
  ['GET', '/api/v1/events', 'Consultar eventos de auditoría'],
  ['POST', '/api/v1/compliance/documents', 'Guardar evidencia privada'],
  ['GET', '/api/platform/access', 'Listar miembros e invitaciones del tenant'],
  ['POST', '/api/platform/access', 'Invitar un operador con rol y vencimiento'],
  ['POST', '/api/platform/api-keys', 'Crear credenciales S2S desde la consola'],
  ['POST', '/api/v1/webhooks', 'Registrar un endpoint HTTPS firmado'],
  ['POST', '/api/v1/webhooks/deliveries/{id}/replay', 'Reencolar una entrega fallida'],
];

export const metadata = {
  title: 'Documentación API — Cimbra',
  description: 'Guía rápida y referencia de la API de infraestructura financiera Cimbra.',
};

export default function DevelopersPage() {
  return (
    <main className="docs-shell">
      <header className="docs-topbar"><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link><span className="docs-product">DOCUMENTACIÓN</span><div><Link href="/openapi.yaml">OpenAPI</Link><Link href="/console">Sandbox</Link><Link className="docs-cta" href="/console">Abrir consola ↗</Link></div></header>
      <aside className="docs-sidebar"><nav><strong>COMENZAR</strong><a className="active" href="#quickstart">Introducción</a><a href="#auth">Autenticación</a><a href="#api-keys">API keys</a><a href="#webhooks">Webhooks</a><strong>RECURSOS IMPLEMENTADOS</strong><a href="#resources">Organization access</a><a href="#resources">Customers</a><a href="#resources">Accounts</a><a href="#resources">Transfers</a><a href="#resources">Ledger y holds</a><a href="#resources">Risk y casos</a><a href="#resources">Reconciliation y settlement</a><a href="#resources">Approvals</a><a href="#resources">Cards</a><a href="#resources">Compliance</a><a href="#idempotency">Idempotencia</a></nav><div className="docs-version">API VERSION <b>2026-08-29</b></div></aside>
      <article className="docs-content">
        <div className="docs-breadcrumb">DOCUMENTACIÓN <span>/</span> COMENZAR</div>
        <section id="quickstart"><p className="eyebrow"><span /> QUICKSTART</p><h1>Construí tu primera<br />integración.</h1><p className="docs-lede">Creá un cliente, abrí una cuenta y ejecutá una transferencia en sandbox con una API consistente y recursos predecibles.</p><div className="docs-callout"><i>i</i><div><strong>Sandbox seguro</strong><p>Las operaciones usan un ledger persistente y webhooks reales, pero no mueven dinero real ni emiten instrumentos en redes de pago.</p></div></div></section>
        <section className="docs-step" id="auth"><span>01</span><div><h2>Autenticá cada request</h2><p>La consola usa sesión first-party. Las integraciones backend usan una API key Bearer propia de Cimbra, vinculada a una organización y limitada por scopes.</p><div className="docs-code"><div><b>HTTP</b><button>Servidor a servidor</button></div><pre><code><em>Authorization:</em> Bearer cim_sk_test_••••••••{`\n`}<em>Content-Type:</em> application/json{`\n`}<em>Idempotency-Key:</em> ik_29f••••••••{`\n`}<em>X-Request-Id:</em> req_checkout_1042</code></pre></div></div></section>
        <section className="docs-step"><span>02</span><div><h2>Creá un cliente con el SDK</h2><p>El SDK TypeScript genera idempotencia y request IDs, aplica timeouts y sólo reintenta operaciones seguras. Un customer representa a la persona o empresa titular.</p><div className="docs-code"><div><b>TYPESCRIPT</b><button>@cimbra/sdk</button></div><pre><code><i>const</i> cimbra = <i>new</i> Cimbra({'{'} apiKey: process.env.CIMBRA_API_KEY {'}'});{`\n`}<i>const</i> result = <i>await</i> cimbra.customers.create({'{'}{`\n`}  type: <em>&quot;individual&quot;</em>,{`\n`}  name: <em>&quot;Sofía Martínez&quot;</em>,{`\n`}  taxId: <em>&quot;20123456789&quot;</em>,{`\n`}  country: <em>&quot;AR&quot;</em>{`\n`}{'}'});{`\n\n`}console.log(result.data.customer.id, result.requestId);</code></pre></div></div></section>
        <section className="docs-step" id="api-keys"><span>03</span><div><h2>Claves con mínimo privilegio</h2><p>Creá y rotá API keys desde Developers en la consola. El secreto sólo aparece al crear o rotar; Cimbra persiste su hash, registra el último uso y aplica revocación inmediata y vencimiento. Las claves pueden consultar aprobaciones con <code>approvals:read</code>, pero las decisiones maker/checker son humanas, requieren sesión y MFA.</p><div className="docs-code"><div><b>SCOPES</b><button>Bearer</button></div><pre><code>customers:read/write      accounts:read/write{`\n`}cards:read/write          transfers:read/write{`\n`}payments:read/write       risk:read/write{`\n`}reconciliation:read/write settlements:read/write{`\n`}platform:read             ledger:read{`\n`}events:read               approvals:read{`\n`}compliance:write          webhooks:manage</code></pre></div></div></section>
        <section className="docs-step" id="webhooks"><span>04</span><div><h2>Verificá cada webhook</h2><p>El body JSON exacto se firma con HMAC-SHA256 usando tu signing secret. Verificá el timestamp, rechazá mensajes antiguos y deduplicá por <code>Cimbra-Event-Id</code>. Sólo se aceptan destinos HTTPS públicos.</p><div className="docs-code"><div><b>HEADERS</b><button>HMAC-SHA256</button></div><pre><code><em>Cimbra-Event-Id:</em> &lt;uuid&gt;{`\n`}<em>Cimbra-Delivery-Id:</em> &lt;uuid&gt;{`\n`}<em>Cimbra-Timestamp:</em> 1787941200{`\n`}<em>Cimbra-Signature:</em> t=1787941200,v1=&lt;hex&gt;{`\n\n`}signed_payload = timestamp + <i>&quot;.&quot;</i> + raw_body</code></pre></div></div></section>
        <section id="resources" className="docs-resources"><h2>Recursos principales</h2><p>Contrato implementado y publicado en OpenAPI.</p>{resources.map(([method,path,description])=><a href="/openapi.yaml" key={path}><b>{method}</b><code>{path}</code><span>{description}</span><i>→</i></a>)}</section>
        <section id="idempotency" className="docs-footer-cta"><h2>Idempotencia de extremo a extremo</h2><p>Cada alta y movimiento de la API v1 requiere un <code>Idempotency-Key</code> estable. Repetir el mismo payload devuelve el recurso original; reutilizar la clave con datos distintos responde 409. Cada respuesta incluye <code>X-Request-Id</code> y límites de consumo.</p><Link className="button button-primary" href="/console">Abrir sandbox <span>↗</span></Link></section>
      </article>
      <aside className="docs-toc"><strong>EN ESTA PÁGINA</strong><a href="#quickstart">Quickstart</a><a href="#auth">Autenticación</a><a href="#api-keys">API keys</a><a href="#webhooks">Webhooks</a><a href="#resources">Recursos</a><a href="#idempotency">Idempotencia</a><div><span>¿Necesitás ayuda?</span><Link href="/#demo">Hablar con un ingeniero →</Link></div></aside>
    </main>
  );
}
