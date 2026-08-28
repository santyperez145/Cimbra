# Cimbra

Cimbra es una plataforma de infraestructura financiera modular para Latinoamérica. Este repositorio contiene el sitio comercial, documentación, consola autenticada y un sandbox persistente con cuentas, ledger de doble partida, transferencias idempotentes, holds, reversas, tarjetas de prueba, evidencia privada, credenciales S2S y webhooks firmados.

## Estado del producto

La aplicación es un MVP lanzable para venta, discovery e integración en sandbox. No mueve fondos reales ni sustituye licencias, contratos con bancos patrocinadores, procesadores, redes de tarjetas o proveedores KYC/AML. La interfaz separa explícitamente sandbox y producción para evitar confusión.

Superficies disponibles:

- `/` — propuesta comercial y captación persistente de leads.
- `/developers` — quickstart y referencia de los endpoints implementados.
- `/login` — registro e inicio de sesión propio con usuario/email y contraseña; OAuth Google y Apple se activa al configurar sus credenciales.
- `/console` — consola protegida con sesiones de servidor, organización y datos propios.
- `/api/health` — healthcheck sin caché.
- `/api/v1/*` — API pública versionada para customers, accounts, cards, transfers, reversas, holds, ledger, events, compliance y webhooks.
- `/api/sandbox/*` — alias de compatibilidad deprecado; las integraciones nuevas deben usar v1.
- `/api/platform/api-keys` — claves Bearer con scopes, vencimiento, rate limit, rotación y revocación inmediata.
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
npm run test:db
npm run typecheck
npm run lint
npm run build
```

La identidad de Cimbra usa PBKDF2-HMAC-SHA-256 con 600.000 iteraciones, sesiones opacas revocables en PostgreSQL, cookies `HttpOnly`, protección de origen y límites de intentos. Las API keys sólo se almacenan como hash. Los signing secrets usan AES-256-GCM en reposo y los webhooks HMAC-SHA256 en tránsito. Ningún secreto se guarda en el cliente ni en el repositorio.

## Infraestructura y despliegue

La aplicación corre sobre Next.js en Vercel, PostgreSQL administrado y Vercel Blob privado. La capa de datos acepta una URL PostgreSQL estándar y no acopla el dominio a un proveedor concreto.

1. Importá este repositorio como un proyecto de Vercel.
2. Agregá una integración PostgreSQL desde Vercel Marketplace y verificá que exponga `DATABASE_URL`.
3. Creá un Blob store privado y vinculalo al proyecto para obtener `BLOB_READ_WRITE_TOKEN`.
4. Cargá `CIMBRA_PUBLIC_URL` y `NEXT_PUBLIC_CIMBRA_PUBLIC_URL` con el dominio público HTTPS.
5. Generá valores aleatorios independientes de 32 bytes para `CIMBRA_ENCRYPTION_KEY` y `CRON_SECRET`; guardalos como secretos del entorno.
6. Cargá las credenciales de Google y Apple indicadas en `.env.example` si esos proveedores se habilitarán.
7. Ejecutá `npm run db:migrate` una vez por ambiente antes de desplegar el código que depende de la migración. Las migraciones son la única fuente de verdad del esquema.
8. Desplegá con la integración Git o mediante `npm run deploy`.

Redirect URIs a registrar:

- Google: `https://TU_DOMINIO/api/auth/oauth/google/callback`
- Apple: `https://TU_DOMINIO/api/auth/oauth/apple/callback`

Apple requiere un Services ID asociado a una app habilitada para Sign in with Apple, además de Team ID, Key ID y una clave privada `.p8`. Para desarrollo local copiá `.env.example` a `.env.local`; el archivo local está ignorado por Git.

## Garantías financieras del sandbox

- montos en unidades mínimas enteras (`BIGINT`), con escala por moneda;
- journals balanceados y separación obligatoria de tenant y moneda en PostgreSQL;
- postings inmutables; las correcciones crean journals compensatorios;
- idempotencia por organización para customers, accounts, cards, transferencias, journals y holds;
- saldo disponible derivado del saldo contable menos las reservas activas;
- escrituras financieras y auditoría dentro de la misma transacción.

## Garantías de integración

- API keys con formato identificable, secreto visible una vez, hash en servidor y scopes de mínimo privilegio;
- rate limit atómico por credencial, headers de límite, request IDs correlacionables y revocación efectiva en el siguiente request;
- outbox de eventos creado dentro de la misma transacción que el cambio de dominio;
- webhooks HTTPS firmados sobre `timestamp.raw_body`, sin redirects y con bloqueo de redes privadas;
- leasing con `FOR UPDATE SKIP LOCKED`, backoff durable, intentos persistidos y replay manual;
- dispatcher protegido por `CRON_SECRET` y ejecución inmediata post-response.

## SDK TypeScript

El paquete `@cimbra/sdk` vive en el monorepo. Genera idempotency keys para escrituras reintentables, conserva el mismo `X-Request-Id`, tipa errores HTTP/conexión/timeout y verifica firmas de webhook sobre el cuerpo crudo.

```bash
npm run sdk:build
npm run sdk:pack
```

La publicación en un registry requiere credenciales y aprobación de release; el tarball se valida en CI sin publicar artefactos por accidente.

## Infraestructura propia

El `Dockerfile` produce una imagen standalone sin proceso root. [`infra/README.md`](infra/README.md) y `infra/terraform/aws` definen el piloto sobre ECS/Fargate, PostgreSQL Multi-AZ con PITR, KMS/Secrets Manager, WAF, autoscaling, observabilidad y el recovery dispatcher del outbox. Terraform sólo debe aplicarse después de revisar plan, costo y cuenta de destino.

## Documentos de dirección

- [Arquitectura objetivo](docs/ARCHITECTURE.md)
- [Estrategia competitiva y negocio](docs/STRATEGY.md)
- [Plan de lanzamiento y gates](docs/LAUNCH.md)

## Marca

`Cimbra` es un nombre de trabajo. Antes de invertir en adquisición, dominio o contratos debe completarse búsqueda marcaria y societaria en cada jurisdicción objetivo.
