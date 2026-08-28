import Link from 'next/link';

const resources = [
  ['POST', '/api/sandbox/customers', 'Crear una persona o empresa'],
  ['POST', '/api/sandbox/accounts', 'Abrir una cuenta financiera'],
  ['POST', '/api/sandbox/transfers', 'Crear una transferencia'],
  ['POST', '/api/sandbox/cards', 'Emitir una tarjeta'],
  ['GET', '/api/sandbox/events', 'Consultar eventos de auditoría'],
];

export const metadata = {
  title: 'Documentación API — Cimbra',
  description: 'Guía rápida y referencia de la API de infraestructura financiera Cimbra.',
};

export default function DevelopersPage() {
  return (
    <main className="docs-shell">
      <header className="docs-topbar"><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link><span className="docs-product">DOCUMENTACIÓN</span><div><Link href="/openapi.yaml">OpenAPI</Link><Link href="/console">Sandbox</Link><Link className="docs-cta" href="/console">Abrir consola ↗</Link></div></header>
      <aside className="docs-sidebar"><label>Buscar en la documentación <span>⌘K</span></label><nav><strong>COMENZAR</strong><a className="active" href="#quickstart">Introducción</a><a href="#quickstart">Quickstart</a><a href="#auth">Autenticación</a><a href="#environments">Entornos</a><strong>PRODUCTOS</strong><a href="#resources">Customers</a><a href="#resources">Accounts</a><a href="#resources">Payments</a><a href="#resources">Cards</a><a href="#resources">Lending</a><a href="#resources">Compliance</a><strong>PLATAFORMA</strong><a href="#webhooks">Webhooks</a><a href="#errors">Errores</a><a href="#idempotency">Idempotencia</a></nav><div className="docs-version">API VERSION <b>2026-08-01</b></div></aside>
      <article className="docs-content">
        <div className="docs-breadcrumb">DOCUMENTACIÓN <span>/</span> COMENZAR</div>
        <section id="quickstart"><p className="eyebrow"><span /> QUICKSTART</p><h1>Construí tu primera<br />integración.</h1><p className="docs-lede">Creá un cliente, abrí una cuenta y ejecutá una transferencia en sandbox con una API consistente y recursos predecibles.</p><div className="docs-callout"><i>i</i><div><strong>Sandbox seguro</strong><p>Las credenciales de prueba no mueven dinero real. Podés explorar todos los flujos, errores y webhooks.</p></div></div></section>
        <section className="docs-step" id="auth"><span>01</span><div><h2>Autenticá tu sesión</h2><p>El sandbox alojado usa la identidad de tu sesión en Cimbra. Los endpoints operativos rechazan cualquier request anónimo y resuelven la organización del usuario en el servidor.</p><div className="docs-code"><div><b>HTTP</b><button>Sesión administrada</button></div><pre><code><em>Content-Type:</em> application/json{`\n`}<em>Idempotency-Key:</em> ik_29f••••••••{`\n`}<em>Cookie:</em> sesión segura administrada por la plataforma</code></pre></div></div></section>
        <section className="docs-step"><span>02</span><div><h2>Creá un cliente</h2><p>Un customer representa a la persona o empresa titular de tus productos financieros. Sólo conservamos los últimos cuatro dígitos del identificador fiscal en este sandbox.</p><div className="docs-code"><div><b>JAVASCRIPT</b><button>Copiar</button></div><pre><code><i>const</i> response = <i>await</i> fetch(<em>&quot;/api/sandbox/customers&quot;</em>, {'{'}{`\n`}  method: <em>&quot;POST&quot;</em>,{`\n`}  headers: {'{'} <em>&quot;Content-Type&quot;</em>: <em>&quot;application/json&quot;</em> {'}'},{`\n`}  body: JSON.stringify({'{'}{`\n`}    type: <em>&quot;individual&quot;</em>,{`\n`}    name: <em>&quot;Sofía Martínez&quot;</em>,{`\n`}    taxId: <em>&quot;20123456789&quot;</em>,{`\n`}    country: <em>&quot;AR&quot;</em>{`\n`}  {'}'}){`\n`}{'}'});{`\n\n`}<i>const</i> {'{'} customer {'}'} = <i>await</i> response.json();</code></pre></div></div></section>
        <section id="resources" className="docs-resources"><h2>Recursos principales</h2><p>La misma semántica en todos los países y productos.</p>{resources.map(([method,path,description])=><a href="#quickstart" key={path}><b>{method}</b><code>{path}</code><span>{description}</span><i>→</i></a>)}</section>
        <section id="idempotency" className="docs-footer-cta"><h2>¿Listo para probar?</h2><p>La consola incluye credenciales, logs y un explorador de eventos.</p><Link className="button button-primary" href="/console">Abrir sandbox <span>↗</span></Link></section>
      </article>
      <aside className="docs-toc"><strong>EN ESTA PÁGINA</strong><a href="#quickstart">Quickstart</a><a href="#auth">Autenticación</a><a href="#resources">Recursos</a><a href="#idempotency">Idempotencia</a><div><span>¿Necesitás ayuda?</span><Link href="/#demo">Hablar con un ingeniero →</Link></div></aside>
    </main>
  );
}
