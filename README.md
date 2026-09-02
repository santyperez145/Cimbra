# Cimbra

Cimbra es una plataforma de infraestructura financiera modular para Latinoamérica. Este repositorio contiene el sitio comercial, documentación, consola autenticada y el núcleo productivo ejecutándose hoy en entorno sandbox: tenancy/RBAC, cuentas, ledger de doble partida, wallets con bolsillos, book transfers atómicos, estados de cuenta paginados, transferencias idempotentes, cobranzas por link, beneficiarios protegidos, payouts masivos asíncronos, motor de riesgo, step-up OTP y SLO de decisión medido, casos, holds, conciliación, excepciones, disputas parciales con créditos compensables, cola operativa con SLA, reversas, doble aprobación maker/checker, programas y lifecycle de tarjetas, controles versionados, evidencia privada, credenciales S2S y webhooks firmados.

## Estado del producto

La aplicación es un MVP lanzable para venta, discovery e integración. El contrato API es el de producción; el host activo es sandbox, como BIND APIBANK, sandbox.pismolabs.io y sandbox.api.pomelo.la. Live se habilita cuando `GET /api/v1/live-readiness` marque `liveReady`: hostname de producción, producto en Go Live, rieles oficiales (BCRA/Coelsa/sponsor/esquema) en live y adaptador Cimbra registrado. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son conectores.

Superficies disponibles:

- `/` — propuesta comercial profesional, estado de sesión contextual, prueba técnica, casos de uso, modelo de acceso y captación persistente de leads.
- `/developers` — portal técnico generado desde OpenAPI con entornos, quickstart ejecutable, auth/RBAC/scopes, errores, rate limits, SDK descargable, webhooks, catálogo de eventos y las 179 operaciones publicadas.
- `/login` — registro e inicio de sesión propio con usuario/email y contraseña; OAuth Google y Apple se activa al configurar sus credenciales.
- `/forgot-password`, `/reset-password` y `/verify-email` — ciclo de vida de cuenta con tokens opacos, expiración, uso único y respuestas anti-enumeración.
- `/console` — consola protegida y consciente del rol; owner/admin administran miembros e invitaciones, operator ejecuta, viewer trabaja en modo lectura y Operaciones unifica ownership, SLA y expedientes de riesgo/conciliación.
- `/api/health` — readiness sin caché para esquema PostgreSQL, secretos críticos y modo operativo (`environment`, `liveReady`), sin exponer valores secretos.
- `/api/v1/*` — API pública versionada. Incluye `GET /api/v1/live-readiness` (entornos, productos, rieles oficiales BCRA/Coelsa/sponsor y camino PSPCP) además de customers, KYC/KYB, accounts, statements, wallets, book transfers, pagos instantáneos AR, cobranzas, cards, transfers, payments, payouts, billers, riesgo, conciliación, operaciones, settlement, aprobaciones, holds, ledger, events, compliance y webhooks.
- `/api/sandbox/*` — alias de compatibilidad deprecado; las integraciones nuevas deben usar v1.
- `/api/platform/api-keys` — claves Bearer con scopes, vencimiento, rate limit, rotación y revocación inmediata.
- `/api/platform/access` — miembros, invitaciones verificadas, jerarquía de roles, revocación y trazabilidad del tenant.
- `/api/platform/approval-policy` — políticas de doble control por acción; habilitarlas requiere owner con MFA y otro owner/admin con MFA.
- `/api/platform/webhooks` — administración de compatibilidad; la superficie pública está en `/api/v1/webhooks`.
- `packages/sdk` — SDK TypeScript oficial, tipado, empaquetable y con verificación de webhooks.

## Desarrollo

Requisitos: Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

Validación:

```bash
npm run db:generate
npm test
npm run sdk:build
npm run sdk:pack
npm run sdk:artifact
npm run test:db
npm run typecheck
npm run lint
npm run build
npm run start:smoke
```

La identidad de Cimbra usa PBKDF2-HMAC-SHA-256 con 600.000 iteraciones, sesiones opacas revocables en PostgreSQL, cookies `HttpOnly`, protección de origen y límites de intentos. Incluye verificación de email, recuperación con cierre global de sesiones y MFA TOTP interoperable con bloqueo de replay; los ocho recovery codes de 80 bits se muestran una vez y sólo se persisten como hash. Las API keys sólo se almacenan como hash. Los secretos TOTP y de firma usan AES-256-GCM en reposo y los webhooks HMAC-SHA256 en tránsito. Ningún secreto se guarda en el cliente ni en el repositorio.

El acceso de consola usa roles canónicos `owner`, `admin`, `operator` y `viewer`. Una matriz única de capacidades gobierna las rutas API, la navegación y los CTAs; cada mutación se revalida en servidor. Las invitaciones duran siete días, sólo se aceptan al ingresar con el email verificado, no permiten que un admin eleve o administre otros admins y nunca permiten modificar o eliminar al owner desde el flujo delegado. Cada alta, aceptación, revocación, cambio de rol y baja genera auditoría y webhook. Una sesión vencida vuelve a login preservando el destino; un rol insuficiente recibe `403` sin cerrar una sesión válida.

Settlement, transferencias salientes, book transfers, lotes de payouts, resoluciones de casos de riesgo, excepciones de conciliación y disputas admiten políticas de doble aprobación. El maker crea la solicitud y nunca puede resolverla; un owner/admin distinto, con MFA, actúa como checker. Aprobar autoriza y revalida el recurso dentro de la misma transacción. Una transferencia pendiente no reserva fondos; un lote no comienza a ejecutar; un caso, una diferencia o una disputa protegidos permanecen sin cambio hasta la decisión, y un hold vinculado no puede resolverse por el endpoint genérico mientras la política de riesgo esté activa. Rechazo, cancelación, fallo, expiración, auditoría y webhooks conservan el historial. Las API keys con scopes de escritura pueden originar solicitudes y con `approvals:read` consultar su estado, pero aprobar o rechazar siempre exige una sesión humana.

## Infraestructura y despliegue

La aplicación corre sobre Next.js en Vercel, PostgreSQL administrado y Vercel Blob privado. La capa de datos acepta una URL PostgreSQL estándar y no acopla el dominio a un proveedor concreto. `DATABASE_URL` no significa crear otra base: es el nombre estándar de la variable secreta con la que Vercel entrega a la aplicación la conexión de la base ya vinculada. Si el marketplace expone también `DATABASE_URL_UNPOOLED` o `POSTGRES_URL_NON_POOLING`, las migraciones y las pruebas de integración usan esa URL directa; el runtime puede usar el pooler porque desactiva prepared statements, exige TLS y mantiene los advisory locks dentro de la transacción.

1. Importá este repositorio como un proyecto de Vercel.
2. Agregá una integración PostgreSQL desde Vercel Marketplace y verificá que exponga `DATABASE_URL`. No hace falta una base local aparte.
3. Creá un Blob store privado y vinculalo al proyecto para obtener `BLOB_READ_WRITE_TOKEN`.
4. Cargá `CIMBRA_PUBLIC_URL` y `NEXT_PUBLIC_CIMBRA_PUBLIC_URL` con el dominio público HTTPS.
5. Generá valores aleatorios independientes de 32 bytes para `CIMBRA_ENCRYPTION_KEY` y `CRON_SECRET`; guardalos como secretos del entorno.
6. Verificá un dominio en Resend y cargá `RESEND_API_KEY` y `CIMBRA_FROM_EMAIL`; sin ambos valores el producto no simula envíos y muestra el proveedor como pendiente. En producción activá `CIMBRA_REQUIRE_VERIFIED_EMAIL=1` y `CIMBRA_REQUIRE_PRIVILEGED_MFA=1`; la infraestructura AWS ya lo hace automáticamente.
7. Cargá las credenciales de Google y Apple indicadas en `.env.example` si esos proveedores se habilitarán.
8. Ejecutá `npm run db:migrate` una vez por ambiente antes de desplegar el código que depende de la migración. Las migraciones son la única fuente de verdad del esquema.
9. Desplegá con la integración Git o mediante `npm run deploy`.

Redirect URIs a registrar:

- Google: `https://TU_DOMINIO/api/auth/oauth/google/callback`
- Apple: `https://TU_DOMINIO/api/auth/oauth/apple/callback`

Apple requiere un Services ID asociado a una app habilitada para Sign in with Apple, además de Team ID, Key ID y una clave privada `.p8`. Para desarrollo local copiá `.env.example` a `.env.local`; el archivo local está ignorado por Git.

## Garantías financieras del sandbox

- montos en unidades mínimas enteras (`BIGINT`), con escala por moneda;
- journals balanceados y separación obligatoria de tenant y moneda en PostgreSQL;
- postings inmutables; las correcciones crean journals compensatorios;
- idempotencia por organización para customers, accounts, cards, book transfers, transferencias, journals, creación y transición de disputas y resolución de holds;
- saldo disponible derivado del saldo contable menos las reservas activas;
- escrituras financieras y auditoría dentro de la misma transacción.
- beneficiarios con destino convertido a digest tenant-scoped, lote inmutable de 1 a 100 ítems, programación y deadline, lease de ejecución, riesgo/ledger por ítem, estados agregados, doble aprobación opcional y CSV de resultados;
- evaluaciones de riesgo explicables vinculadas a cada movimiento, con referencias de dispositivo/identidad hasheadas por tenant, señales derivadas, listas allow/watch/block, familias de políticas versionadas, lifecycle champion/challenger, simulaciones agregadas, step-up OTP cifrado/hasheado con intentos append-only y expiración, SLO p50/p95/p99 medido, resultados confirmados inmutables, precisión/recall, pérdidas por moneda, casos y holds sincronizados;
- conciliación exacta de lotes contra el ledger, faltantes en ambos sentidos y excepciones resolubles con idempotencia.
- importación CSV UTF-8 con checksum y ciclos de settlement sandbox únicos, programables, auditados y emitidos por webhook.
- disputas parciales sobre débitos liquidados, ventana explícita, estados inmutables, crédito provisional o definitivo en doble partida y compensación contable si el reclamo se pierde;
- políticas maker/checker fail-closed para settlement, transferencias, book transfers, lotes de payouts, casos de riesgo, excepciones de conciliación y disputas, con locks concurrentes, revalidación y autorización atómica.
- wallets por customer con programas tenant, bolsillos mapeados a cuentas de producto, freeze/close y movimientos internos; el sandbox no custodia fondos.
- pagos instantáneos sandbox para Argentina: CVU 0009999, alias de tenant, confirmación de titular, crédito interno o cash-out a settlement, débito interno, QR Cimbra dinámico, estático y de deuda con orden de venta (payload propio, no interoperable) y devoluciones compensatorias; no hay Coelsa, DEBIN ni QR interoperable.
- work queue multitenant para casos de riesgo, excepciones y disputas, con responsable, prioridad, SLA, escalamiento, comentarios inmutables y vínculos a evidencia privada.

## Garantías de integración

- API keys con formato identificable, secreto visible una vez, hash en servidor y scopes de mínimo privilegio;
- rate limit atómico por credencial, headers de límite, request IDs correlacionables y revocación efectiva en el siguiente request;
- outbox de eventos creado dentro de la misma transacción que el cambio de dominio;
- webhooks HTTPS firmados sobre `timestamp.raw_body`, sin redirects y con bloqueo de redes privadas;
- leasing con `FOR UPDATE SKIP LOCKED`, backoff durable, intentos persistidos y replay manual;
- dispatcher protegido por `CRON_SECRET`; recupera el outbox, mandatos recurrentes, lotes de payouts con lease y settlement programado. Vercel lo invoca diariamente en el entorno sin presupuesto y la infraestructura AWS declarada lo programa cada minuto cuando exista autorización de gasto.

## SDK TypeScript

El paquete `@cimbra/sdk` vive en el monorepo. Genera idempotency keys para escrituras reintentables, conserva el mismo `X-Request-Id`, tipa errores HTTP/conexión/timeout y verifica firmas de webhook sobre el cuerpo crudo. La versión preview publicada puede instalarse directamente desde Cimbra:

```bash
npm install https://cimbra-rose.vercel.app/sdk/cimbra-sdk-0.1.0.tgz
```

El artefacto y su checksum SHA-256 se sirven bajo `/sdk`. Todavía no existe una publicación en el registry público de npm.

```bash
npm run sdk:build
npm run sdk:pack
npm run sdk:artifact
```

`sdk:artifact` recompila el paquete, genera el tarball público y actualiza su checksum. La publicación en un registry sigue requiriendo credenciales y aprobación explícita de release.

## Infraestructura propia

El `Dockerfile` produce una imagen standalone sin proceso root. El build genera siempre ese mismo runtime, incluso si el entorno local fue descargado desde Vercel, e incorpora en el artefacto sus assets públicos y de Next.js. Como parte obligatoria de `npm run build`, el smoke levanta ese servidor sin base de datos y comprueba por HTTP una página renderizada, un asset compilado y el favicon; `npm run start:smoke` permite repetirlo sin recompilar. Así el workflow existente de CI también ejecuta la prueba sin un gate paralelo. [`infra/README.md`](infra/README.md) y `infra/terraform/aws` definen el piloto sobre ECS/Fargate, PostgreSQL Multi-AZ con PITR, KMS/Secrets Manager, WAF, autoscaling, observabilidad y el recovery dispatcher del outbox. Terraform sólo debe aplicarse después de revisar plan, costo y cuenta de destino.

## Documentos de dirección

- [Arquitectura objetivo](docs/ARCHITECTURE.md)
- [Estrategia competitiva y negocio](docs/STRATEGY.md)
- [Plataforma propia y límites de red](docs/OWN_PLATFORM.md)
- [Plan de lanzamiento y gates](docs/LAUNCH.md)

## Marca

`Cimbra` es un nombre de trabajo. Antes de invertir en adquisición, dominio o contratos debe completarse búsqueda marcaria y societaria en cada jurisdicción objetivo.
