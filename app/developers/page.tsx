import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/auth/session';
import { ROLE_PROFILES } from '@/app/lib/platform/access-policy';
import { loadApiReference, loadSdkRelease } from '@/app/lib/platform/openapi-reference';
import { API_SCOPES } from '@/app/lib/platform/scopes';
import { WEBHOOK_EVENT_TYPES } from '@/app/lib/platform/webhook-events';
import CopyButton from './copy-button';
import EndpointReference from './endpoint-reference';
import PlatformStatus from './platform-status';

export const metadata = {
  title: 'Developers — API, SDK y webhooks de Cimbra',
  description: 'Contrato OpenAPI, SDK TypeScript descargable, quickstarts y referencia verificable del sandbox de Cimbra.',
};

export const dynamic = 'force-dynamic';

const errorResponses = [
  ['400', 'invalid_request', 'Payload, parámetros o Idempotency-Key inválidos.'],
  ['401', 'authentication_required / invalid_api_key', 'Falta la identidad, o la API key es inválida, fue revocada o venció.'],
  ['403', 'insufficient_scope / insufficient_role', 'La identidad existe, pero no tiene el scope o rol requerido.'],
  ['404', 'not_found', 'El recurso no existe dentro del tenant autenticado.'],
  ['409', 'conflict / idempotency_mismatch', 'Conflicto de estado o clave reutilizada con otro payload.'],
  ['422', 'unprocessable_entity', 'La solicitud es válida, pero saldo, riesgo o estado impiden ejecutarla.'],
  ['429', 'rate_limit_exceeded', 'Se agotó la ventana de la API key; respetar Retry-After.'],
  ['5xx', 'internal_error', 'Error transitorio; reintentar sólo cuando Cimbra-Should-Retry sea true.'],
] as const;

const changelog = [
  {
    date: '29 AGO 2026',
    title: 'Issuing nativo: programas, lifecycle y controles',
    detail: 'Programas tenant, estados terminales, controles append-only por límites/canales/MCC, seis eventos, SDK y consola por rol; el sandbox no expone datos PCI ni afirma conexión a redes.',
  },
  {
    date: '29 AGO 2026',
    title: 'Doble control para decisiones operativas',
    detail: 'Casos de riesgo y excepciones de conciliación admiten políticas independientes, revalidación atómica y protección contra bypass de holds.',
  },
  {
    date: '29 AGO 2026',
    title: 'Cola operativa con SLA y evidencia',
    detail: 'Riesgo y conciliación comparten ownership, prioridad, vencimiento, escalamiento, comentarios y documentos privados mediante API, SDK y consola.',
  },
  {
    date: '29 AGO 2026',
    title: 'RBAC y sesiones consistentes',
    detail: 'Una matriz canónica gobierna consola y API; 401 y 403 quedan diferenciados y las sesiones vencidas preservan el destino.',
  },
  {
    date: '29 AGO 2026',
    title: 'Maker/checker para transferencias y settlement',
    detail: 'Solicitudes persistidas, separación de personas, MFA, expiración y revalidación transaccional antes de ejecutar.',
  },
  {
    date: '28 AGO 2026',
    title: 'Riesgo, conciliación y settlement nativos',
    detail: 'Reglas, evaluaciones, casos, importación CSV, excepciones y ciclos sandbox conectados al ledger y a webhooks.',
  },
] as const;

function CodeBlock({ language, value }: { language: string; value: string }) {
  return <div className="docs-code">
    <div><b>{language}</b><CopyButton value={value} /></div>
    <pre><code>{value}</code></pre>
  </div>;
}

export default async function DevelopersPage() {
  const [user, reference] = await Promise.all([getCurrentUser(), Promise.resolve(loadApiReference())]);
  const sdk = loadSdkRelease();
  const sdkDownloadUrl = `${reference.baseUrl}${sdk.downloadPath}`;
  const sdkInstall = `npm install ${sdkDownloadUrl}`;
  const curlQuickstart = `curl --request POST \\
  --url ${reference.baseUrl}/api/v1/customers \\
  --header "Authorization: Bearer \$CIMBRA_API_KEY" \\
  --header "Content-Type: application/json" \\
  --header "Idempotency-Key: customer-quickstart-001" \\
  --header "X-Request-Id: req_quickstart_001" \\
  --data '{
    "type": "business",
    "name": "Comercio del Sur",
    "country": "AR",
    "taxId": "30712345678"
  }'`;
  const sdkQuickstart = `import { Cimbra } from '@cimbra/sdk';

const cimbra = new Cimbra({
  apiKey: process.env.CIMBRA_API_KEY!,
  baseUrl: '${reference.baseUrl}',
});

const result = await cimbra.customers.create({
  type: 'business',
  name: 'Comercio del Sur',
  country: 'AR',
  taxId: '30712345678',
});

console.log(result.data.customer.id, result.requestId);`;
  const customerResponse = `{
  "ok": true,
  "customer": {
    "id": "<uuid>",
    "type": "business",
    "name": "Comercio del Sur",
    "country": "AR",
    "taxIdLast4": "5678",
    "status": "active",
    "createdAt": "<ISO-8601>"
  },
  "replayed": false
}`;
  const webhookPayload = `{
  "id": "<event_uuid>",
  "type": "transfer.created",
  "created_at": "<ISO-8601>",
  "data": {
    "resource_type": "transaction",
    "resource_id": "<transaction_uuid>"
  }
}`;
  const webhookVerification = `import { constructWebhookEvent } from '@cimbra/sdk';

const rawBody = await request.text();
const event = await constructWebhookEvent({
  payload: rawBody,
  signature: request.headers.get('cimbra-signature')!,
  timestamp: request.headers.get('cimbra-timestamp'),
  secret: process.env.CIMBRA_WEBHOOK_SECRET!,
});

console.log(event.id, event.type, event.created_at);
return new Response(null, { status: 204 });`;
  const structuredError = `{
  "error": {
    "type": "cimbra_api_error",
    "code": "insufficient_scope",
    "message": "La API key no incluye el scope customers:write.",
    "requestId": "req_<id>"
  }
}`;

  return <main className="docs-shell docs-shell-expanded">
    <header className="docs-topbar">
      <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link>
      <span className="docs-product">DEVELOPER PLATFORM</span>
      <div>
        <PlatformStatus />
        <Link href="/openapi.yaml">OpenAPI</Link>
        {user ? <Link className="docs-cta" href="/console">Abrir consola ↗</Link> : <Link className="docs-cta" href="/login?return_to=%2Fconsole">Ingresar ↗</Link>}
      </div>
    </header>

    <aside className="docs-sidebar">
      <nav aria-label="Documentación">
        <strong>COMENZAR</strong>
        <a className="active" href="#overview">Descripción general</a>
        <a href="#environments">Entornos y disponibilidad</a>
        <a href="#quickstart">Quickstart real</a>
        <strong>CONCEPTOS</strong>
        <a href="#authentication">Autenticación y acceso</a>
        <a href="#idempotency">Idempotencia y reintentos</a>
        <a href="#pagination">Paginación y dinero</a>
        <a href="#errors">Errores y rate limits</a>
        <strong>INTEGRACIÓN</strong>
        <a href="#sdk">SDK TypeScript</a>
        <a href="#webhooks">Webhooks y eventos</a>
        <a href="#reference">Referencia completa</a>
        <a href="#changelog">Changelog</a>
      </nav>
      <div className="docs-version"><span>API {reference.version}</span><b>SDK {sdk.version}</b></div>
    </aside>

    <article className="docs-content docs-content-expanded">
      <details className="docs-mobile-nav">
        <summary>Índice de documentación</summary>
        <nav><a href="#overview">Overview</a><a href="#quickstart">Quickstart</a><a href="#authentication">Auth</a><a href="#sdk">SDK</a><a href="#webhooks">Webhooks</a><a href="#reference">API reference</a></nav>
      </details>

      <section id="overview" className="docs-hero">
        <div className="docs-breadcrumb">DOCUMENTACIÓN <span>/</span> API V1</div>
        <p className="eyebrow"><span /> CONTRATO VERIFICABLE</p>
        <h1>Integrá sobre cosas<br />que existen.</h1>
        <p className="docs-lede">Esta documentación se construye desde el mismo OpenAPI que publica Cimbra y describe únicamente el sandbox desplegado: autenticación, recursos, SDK, errores, eventos y límites operativos reales.</p>
        <div className="docs-proof-grid" aria-label="Evidencia técnica publicada">
          <article><strong>OpenAPI 3.1</strong><span>Contrato descargable</span></article>
          <article><strong>{reference.operations.length}</strong><span>Operaciones documentadas</span></article>
          <article><strong>{API_SCOPES.length}</strong><span>Scopes S2S canónicos</span></article>
          <article><strong>{WEBHOOK_EVENT_TYPES.length}</strong><span>Tipos de evento emitidos</span></article>
        </div>
        <div className="docs-callout"><i>i</i><div><strong>Sandbox persistente, no dinero real</strong><p>Customers, cuentas, programas y lifecycle de tarjetas, controles, movimientos, ledger, riesgo, conciliación, aprobaciones y webhooks se persisten. No existen rieles bancarios o de tarjetas homologados, PAN/CVV ni instrumentos emitidos en redes de pago.</p></div></div>
      </section>

      <section id="environments" className="docs-section">
        <p className="docs-kicker">ENTORNOS</p><h2>Una URL activa. Ninguna promesa ficticia.</h2>
        <div className="environment-grid">
          <article className="environment-card available"><div><i /> SANDBOX PÚBLICO</div><code>{reference.baseUrl}</code><p>Base de datos persistente, API keys de prueba, ledger y eventos. Los secretos usan el prefijo <code>cim_sk_test_</code>.</p><a href="/api/health">Consultar healthcheck JSON ↗</a></article>
          <article className="environment-card unavailable"><div><i /> PRODUCCIÓN</div><strong>No habilitada</strong><p>Se habilitará por jurisdicción y producto sólo después de riel directo, contrato, licencia o sponsor, certificación, SLO, runbooks y pruebas operativas.</p><span>Sin URL ni credenciales productivas hoy</span></article>
        </div>
        <div className="artifact-matrix">
          <div><span>OpenAPI YAML</span><b className="available">Disponible</b><a href="/openapi.yaml">Descargar</a></div>
          <div><span>SDK TypeScript {sdk.version}</span><b className="preview">Preview verificable</b><a href={sdk.downloadPath}>Descargar</a></div>
          <div><span>Postman Collection</span><b className="unavailable">No publicada</b><span>Backlog</span></div>
          <div><span>SDKs Java / Python / Go</span><b className="unavailable">No publicados</b><span>Backlog</span></div>
        </div>
      </section>

      <section id="quickstart" className="docs-section">
        <p className="docs-kicker">QUICKSTART</p><h2>Primer request, sin pasos inventados.</h2>
        <p className="docs-section-lede">Una API key sólo puede ser creada por Owner o Admin desde la sección Developers de la consola. El secreto se muestra una vez y Cimbra conserva únicamente su hash.</p>
        <div className="quickstart-steps">
          <article><span>01</span><div><strong>Entrá a la consola</strong><p>{user ? `Tu sesión está activa como ${user.displayName}. Abrí Developers y generá una clave con customers:write.` : 'Iniciá sesión, abrí Developers y generá una clave con customers:write.'}</p><Link href={user ? '/console' : '/login?return_to=%2Fconsole'}>{user ? 'Abrir consola' : 'Ingresar'} ↗</Link></div></article>
          <article><span>02</span><div><strong>Guardá el secreto en backend</strong><p>Usá una variable de entorno. Nunca expongas la clave en navegador, app móvil, repositorio o logs.</p><code>CIMBRA_API_KEY=cim_sk_test_••••</code></div></article>
          <article><span>03</span><div><strong>Creá un customer</strong><p>Mandá una clave de idempotencia estable por operación lógica. El identificador y el tenant se resuelven en servidor.</p></div></article>
        </div>
        <CodeBlock language="CURL · EJECUTABLE" value={curlQuickstart} />
        <p className="docs-code-caption">Respuesta real: HTTP 201 en la primera creación y HTTP 200 con <code>Idempotent-Replayed: true</code> al repetir exactamente el request.</p>
        <CodeBlock language="JSON · 201 CREATED" value={customerResponse} />
      </section>

      <section id="authentication" className="docs-section">
        <p className="docs-kicker">AUTENTICACIÓN Y AUTORIZACIÓN</p><h2>Dos identidades, controles distintos.</h2>
        <div className="auth-mode-grid">
          <article><span>HUMANOS</span><h3>Sesión first-party</h3><p>Cookie opaca, hasheada en servidor. RBAC decide qué puede ver y ejecutar cada rol; las mutaciones validan origen y las decisiones maker/checker requieren sesión humana.</p><code>__Host-cimbra_session</code></article>
          <article><span>MACHINE-TO-MACHINE</span><h3>API key con scopes</h3><p>Bearer propio del tenant, revocable, con vencimiento y rate limit. No puede aprobar, rechazar ni cancelar solicitudes maker/checker.</p><code>Authorization: Bearer cim_sk_test_…</code></article>
        </div>
        <div className="role-contract-grid">
          {Object.entries(ROLE_PROFILES).map(([role, profile]) => <article key={role}><div><strong>{profile.label}</strong><span>{profile.posture}</span></div><p>{profile.description}</p>{role === 'owner' || role === 'admin' ? <b>Puede administrar API keys</b> : <b>No administra credenciales</b>}</article>)}
        </div>
        <div className="docs-scope-cloud" aria-label="Scopes disponibles">
          {API_SCOPES.map((scope) => <code key={scope}>{scope}</code>)}
        </div>
        <div className="docs-note"><strong>401 ≠ 403</strong><p><code>401</code> significa que la identidad no fue autenticada. <code>403</code> significa que existe una sesión o API key válida, pero su rol o scope no permite esa operación.</p></div>
      </section>

      <section id="idempotency" className="docs-section docs-contract-section">
        <p className="docs-kicker">CONTRATO HTTP</p><h2>Idempotencia, trazabilidad y retry seguro.</h2>
        <div className="contract-grid">
          <article><span>01</span><h3>Idempotency-Key</h3><p>Obligatoria cuando el endpoint la declara: altas y movimientos reintentables. Admite 8–100 caracteres de <code>A-Z a-z 0-9 . _ : -</code>.</p></article>
          <article><span>02</span><h3>X-Request-Id</h3><p>Podés enviarlo; si falta, Cimbra lo genera. Se devuelve en toda respuesta y el SDK lo conserva durante reintentos.</p></article>
          <article><span>03</span><h3>Replays</h3><p>Misma clave y mismo payload: respuesta original y header <code>Idempotent-Replayed: true</code>. Payload distinto: HTTP 409.</p></article>
          <article><span>04</span><h3>Cimbra-Should-Retry</h3><p>La API marca explícitamente si un error puede reintentarse. El SDK aplica backoff sólo en requests seguros.</p></article>
        </div>
        <div className="docs-note warning"><strong>Límite actual</strong><p>Configuración de webhooks, carga de evidencia y desactivación de reglas todavía no ofrecen replay idempotente; el SDK no las reintenta. La referencia de cada operación indica si acepta <code>Idempotency-Key</code>.</p></div>
      </section>

      <section id="pagination" className="docs-section">
        <p className="docs-kicker">MODELO DE DATOS</p><h2>Cursores estables y montos exactos.</h2>
        <div className="data-contract-grid">
          <article><h3>Paginación</h3><p>Customers, accounts, cards y transfers aceptan <code>limit</code> entre 1 y 100; el valor por defecto es 25. Reutilizá <code>nextCursor</code> mientras <code>hasMore</code> sea true.</p><pre><code>{`{
  "data": [/* recursos */],
  "hasMore": true,
  "nextCursor": "<base64url_opaco>"
}`}</code></pre></article>
          <article><h3>Dinero</h3><p>En requests, enviá montos como string decimal en unidad mayor. En respuestas financieras, <code>amountMinor</code> conserva la representación contable exacta como string.</p><pre><code>{`{
  "amount": "1250.50",
  "amountMinor": "125050",
  "currency": "ARS"
}`}</code></pre></article>
        </div>
        <p className="docs-code-caption">Monedas modeladas: ARS, USD, MXN, COP, BRL, CLP y PEN. Esto no implica disponibilidad de rieles reales en esos países.</p>
      </section>

      <section id="errors" className="docs-section">
        <p className="docs-kicker">ERRORES Y LÍMITES</p><h2>Fallos estructurados y accionables.</h2>
        <CodeBlock language="JSON · ERROR EN API V1" value={structuredError} />
        <div className="error-contract-table">
          {errorResponses.map(([status, code, meaning]) => <div key={status}><b>{status}</b><code>{code}</code><span>{meaning}</span></div>)}
        </div>
        <div className="docs-note"><strong>Rate limit efectivo</strong><p>Las API keys nuevas tienen hoy un límite de <code>300 requests/minuto</code>. Después de autorizar la API key, las respuestas incluyen <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> y <code>X-RateLimit-Reset</code>. Un 429 agrega <code>Retry-After: 60</code>.</p></div>
      </section>

      <section id="sdk" className="docs-section">
        <p className="docs-kicker">SDK TYPESCRIPT</p><h2>Un paquete real, descargable y con checksum.</h2>
        <div className="sdk-release-card">
          <div><span>PREVIEW OFICIAL</span><h3>{sdk.name} · v{sdk.version}</h3><p>Node.js 20+. ESM, declaraciones TypeScript, source maps, timeouts, errores tipados, cursores, reintentos seguros y verificación de webhooks.</p></div>
          <div><a href={sdk.downloadPath}>Descargar .tgz ↗</a><a href={sdk.downloadPath.replace('.tgz', '.sha256')}>SHA-256 ↗</a><small>{(sdk.sizeBytes / 1024).toFixed(1)} kB · licencia propietaria</small></div>
        </div>
        <div className="docs-note warning"><strong>Distribución honesta</strong><p>El SDK todavía no está en npm. El comando instala el artefacto servido por Cimbra; el checksum publicado permite verificar exactamente qué paquete se recibió.</p></div>
        <CodeBlock language="TERMINAL" value={sdkInstall} />
        <div className="sdk-checksum"><span>SHA-256</span><code>{sdk.sha256}</code><CopyButton value={sdk.sha256} label="Copiar hash" /></div>
        <CodeBlock language="TYPESCRIPT" value={sdkQuickstart} />
      </section>

      <section id="webhooks" className="docs-section">
        <p className="docs-kicker">WEBHOOKS</p><h2>Outbox durable, firma y replay operativo.</h2>
        <div className="webhook-contract-grid">
          <article><strong>Entrega</strong><p>POST HTTPS público, puerto 443, timeout de 4 segundos y éxito ante cualquier respuesta 2xx. Redirecciones no se siguen.</p></article>
          <article><strong>Firma</strong><p>HMAC-SHA256 sobre <code>timestamp.raw_body</code>. Ventana predeterminada del SDK: 5 minutos y comparación en tiempo constante.</p></article>
          <article><strong>Reintentos</strong><p>Hasta 7 intentos totales. Backoff después de cada fallo: 1m, 5m, 30m, 2h, 6h y 24h.</p></article>
          <article><strong>Operación</strong><p>Estados, status HTTP, error e historial de intentos quedan persistidos. Owner/Admin puede reencolar una entrega.</p></article>
        </div>
        <CodeBlock language="JSON · EVENTO REAL" value={webhookPayload} />
        <CodeBlock language="TYPESCRIPT · VERIFICACIÓN" value={webhookVerification} />
        <details className="event-catalog"><summary>{WEBHOOK_EVENT_TYPES.length} tipos de evento implementados <span>Ver catálogo</span></summary><div>{WEBHOOK_EVENT_TYPES.map((event) => <code key={event}>{event}</code>)}</div></details>
      </section>

      <section id="reference" className="docs-section docs-reference-section">
        <p className="docs-kicker">API REFERENCE</p><h2>Todo el contrato publicado.</h2>
        <p className="docs-section-lede">La lista siguiente se genera desde <code>public/openapi.yaml</code>; no existe un inventario paralelo escrito a mano. Cada operación muestra autenticación, scope, Content-Type, parámetros y respuestas declaradas.</p>
        <EndpointReference operations={reference.operations} />
      </section>

      <section id="changelog" className="docs-section">
        <p className="docs-kicker">CHANGELOG</p><h2>Cambios que ya están en el runtime.</h2>
        <div className="docs-changelog">{changelog.map((entry) => <article key={`${entry.date}-${entry.title}`}><time>{entry.date}</time><div><h3>{entry.title}</h3><p>{entry.detail}</p></div></article>)}</div>
        <div className="docs-note"><strong>Versionado actual</strong><p>La ruta mayor es <code>/api/v1</code> y cada respuesta publica <code>Cimbra-Version: {reference.version}</code>. Todavía no hay una política de deprecación productiva porque no existe un ambiente de producción habilitado.</p></div>
      </section>
    </article>

    <aside className="docs-toc">
      <strong>EN ESTA PÁGINA</strong>
      <a href="#overview">Overview</a><a href="#environments">Entornos</a><a href="#quickstart">Quickstart</a><a href="#authentication">Autenticación</a><a href="#idempotency">Idempotencia</a><a href="#errors">Errores</a><a href="#sdk">SDK</a><a href="#webhooks">Webhooks</a><a href="#reference">API reference</a><a href="#changelog">Changelog</a>
      <div><span>{user ? `Sesión activa · ${user.displayName.split(' ')[0]}` : '¿Necesitás credenciales?'}</span><Link href={user ? '/console' : '/login?return_to=%2Fconsole'}>{user ? 'Abrir Developers' : 'Ingresar al sandbox'} →</Link></div>
    </aside>
  </main>;
}
