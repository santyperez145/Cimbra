import Link from 'next/link';

const resources = [
  ['POST', '/api/sandbox/customers', 'Crear una persona o empresa'],
  ['POST', '/api/sandbox/accounts', 'Abrir una cuenta financiera'],
  ['POST', '/api/sandbox/cards', 'Emitir una tarjeta'],
  ['POST', '/api/sandbox/transfers', 'Crear una transferencia idempotente'],
  ['POST', '/api/sandbox/transfers/{id}/reverse', 'Revertir mediante un asiento compensatorio'],
  ['GET', '/api/sandbox/ledger', 'Consultar balances, journals y reservas'],
  ['POST', '/api/sandbox/holds/{id}/capture', 'Capturar una reserva activa'],
  ['POST', '/api/sandbox/holds/{id}/release', 'Liberar una reserva activa'],
  ['GET', '/api/sandbox/events', 'Consultar eventos de auditoría'],
  ['POST', '/api/compliance/documents', 'Guardar evidencia privada'],
];

export const metadata = {
  title: 'Documentación API — Cimbra',
  description: 'Guía rápida y referencia de la API de infraestructura financiera Cimbra.',
};

export default function DevelopersPage() {
  return (
    <main className="docs-shell">
      <header className="docs-topbar"><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link><span className="docs-product">DOCUMENTACIÓN</span><div><Link href="/openapi.yaml">OpenAPI</Link><Link href="/console">Sandbox</Link><Link className="docs-cta" href="/console">Abrir consola ↗</Link></div></header>
      <aside className="docs-sidebar"><nav><strong>COMENZAR</strong><a className="active" href="#quickstart">Introducción</a><a href="#auth">Autenticación</a><strong>RECURSOS IMPLEMENTADOS</strong><a href="#resources">Customers</a><a href="#resources">Accounts</a><a href="#resources">Transfers</a><a href="#resources">Ledger y holds</a><a href="#resources">Cards</a><a href="#resources">Compliance</a><a href="#idempotency">Idempotencia</a></nav><div className="docs-version">API VERSION <b>2026-08-28</b></div></aside>
      <article className="docs-content">
        <div className="docs-breadcrumb">DOCUMENTACIÓN <span>/</span> COMENZAR</div>
        <section id="quickstart"><p className="eyebrow"><span /> QUICKSTART</p><h1>Construí tu primera<br />integración.</h1><p className="docs-lede">Creá un cliente, abrí una cuenta y ejecutá una transferencia en sandbox con una API consistente y recursos predecibles.</p><div className="docs-callout"><i>i</i><div><strong>Sandbox seguro</strong><p>Las operaciones usan un ledger persistente, pero no mueven dinero real. API keys y webhooks aún no están habilitados.</p></div></div></section>
        <section className="docs-step" id="auth"><span>01</span><div><h2>Autenticá tu sesión</h2><p>La consola usa identidad propia de Cimbra: email o usuario y contraseña, Google o Apple. Los endpoints operativos rechazan cualquier request anónimo y resuelven la organización en el servidor.</p><div className="docs-code"><div><b>HTTP</b><button>Sesión Cimbra</button></div><pre><code><em>Content-Type:</em> application/json{`\n`}<em>Idempotency-Key:</em> ik_29f••••••••{`\n`}<em>Cookie:</em> __Host-cimbra_session=&lt;token_opaco&gt;</code></pre></div></div></section>
        <section className="docs-step"><span>02</span><div><h2>Creá un cliente</h2><p>Un customer representa a la persona o empresa titular de tus productos financieros. Sólo conservamos los últimos cuatro dígitos del identificador fiscal en este sandbox.</p><div className="docs-code"><div><b>JAVASCRIPT</b><button>Copiar</button></div><pre><code><i>const</i> response = <i>await</i> fetch(<em>&quot;/api/sandbox/customers&quot;</em>, {'{'}{`\n`}  method: <em>&quot;POST&quot;</em>,{`\n`}  headers: {'{'} <em>&quot;Content-Type&quot;</em>: <em>&quot;application/json&quot;</em> {'}'},{`\n`}  body: JSON.stringify({'{'}{`\n`}    type: <em>&quot;individual&quot;</em>,{`\n`}    name: <em>&quot;Sofía Martínez&quot;</em>,{`\n`}    taxId: <em>&quot;20123456789&quot;</em>,{`\n`}    country: <em>&quot;AR&quot;</em>{`\n`}  {'}'}){`\n`}{'}'});{`\n\n`}<i>const</i> {'{'} customer {'}'} = <i>await</i> response.json();</code></pre></div></div></section>
        <section id="resources" className="docs-resources"><h2>Recursos principales</h2><p>Contrato implementado y publicado en OpenAPI.</p>{resources.map(([method,path,description])=><a href="/openapi.yaml" key={path}><b>{method}</b><code>{path}</code><span>{description}</span><i>→</i></a>)}</section>
        <section id="idempotency" className="docs-footer-cta"><h2>Idempotencia financiera</h2><p>Cada transferencia requiere un <code>Idempotency-Key</code> estable. Repetir la solicitud devuelve la operación original y una reversa crea un journal compensatorio: nunca modifica postings anteriores.</p><Link className="button button-primary" href="/console">Abrir sandbox <span>↗</span></Link></section>
      </article>
      <aside className="docs-toc"><strong>EN ESTA PÁGINA</strong><a href="#quickstart">Quickstart</a><a href="#auth">Autenticación</a><a href="#resources">Recursos</a><a href="#idempotency">Idempotencia</a><div><span>¿Necesitás ayuda?</span><Link href="/#demo">Hablar con un ingeniero →</Link></div></aside>
    </main>
  );
}
