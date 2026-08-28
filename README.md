# Cimbra

Cimbra es una plataforma de infraestructura financiera modular para Latinoamérica. Este repositorio contiene el sitio comercial, documentación, consola autenticada y un sandbox persistente con cuentas, ledger de doble partida, transferencias idempotentes, holds, reversas, tarjetas de prueba, evidencia privada y auditoría.

## Estado del producto

La aplicación es un MVP lanzable para venta, discovery e integración en sandbox. No mueve fondos reales ni sustituye licencias, contratos con bancos patrocinadores, procesadores, redes de tarjetas o proveedores KYC/AML. La interfaz separa explícitamente sandbox y producción para evitar confusión.

Superficies disponibles:

- `/` — propuesta comercial y captación persistente de leads.
- `/developers` — quickstart y referencia de los endpoints implementados.
- `/login` — registro e inicio de sesión propio con usuario/email y contraseña, Google y Apple.
- `/console` — consola protegida con sesiones de servidor, organización y datos propios.
- `/api/health` — healthcheck sin caché.
- `/api/sandbox/*` — customers, accounts, cards, transfers, reversas, holds, balances, journals y audit events.
- `/api/compliance/documents` — evidencia privada en almacenamiento de objetos con metadata en base relacional.

## Desarrollo

Requisitos: Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

Validación:

```bash
npm run db:generate
npx tsc --noEmit
npm run lint
npm run build
```

La identidad de Cimbra usa PBKDF2-HMAC-SHA-256 con 600.000 iteraciones, sesiones opacas revocables en PostgreSQL, cookies `HttpOnly`, protección de origen y límites de intentos. Los tokens y secretos OAuth nunca se guardan en el cliente ni en el repositorio.

## Infraestructura y despliegue

La aplicación corre sobre Next.js en Vercel, PostgreSQL administrado y Vercel Blob privado. La capa de datos acepta una URL PostgreSQL estándar y no acopla el dominio a un proveedor concreto.

1. Importá este repositorio como un proyecto de Vercel.
2. Agregá una integración PostgreSQL desde Vercel Marketplace y verificá que exponga `DATABASE_URL`.
3. Creá un Blob store privado y vinculalo al proyecto para obtener `BLOB_READ_WRITE_TOKEN`.
4. Cargá `CIMBRA_PUBLIC_URL` y `NEXT_PUBLIC_CIMBRA_PUBLIC_URL` con el dominio público HTTPS.
5. Cargá las credenciales de Google y Apple indicadas en `.env.example`.
6. Ejecutá `npm run db:migrate` una vez por ambiente antes de desplegar el código que depende de la migración. Las migraciones son la única fuente de verdad del esquema.
7. Desplegá con la integración Git o mediante `npm run deploy`.

Redirect URIs a registrar:

- Google: `https://TU_DOMINIO/api/auth/oauth/google/callback`
- Apple: `https://TU_DOMINIO/api/auth/oauth/apple/callback`

Apple requiere un Services ID asociado a una app habilitada para Sign in with Apple, además de Team ID, Key ID y una clave privada `.p8`. Para desarrollo local copiá `.env.example` a `.env.local`; el archivo local está ignorado por Git.

## Garantías financieras del sandbox

- montos en unidades mínimas enteras (`BIGINT`), con escala por moneda;
- journals balanceados y separación obligatoria de tenant y moneda en PostgreSQL;
- postings inmutables; las correcciones crean journals compensatorios;
- idempotencia por organización para transferencias, journals y holds;
- saldo disponible derivado del saldo contable menos las reservas activas;
- escrituras financieras y auditoría dentro de la misma transacción.

## Documentos de dirección

- [Arquitectura objetivo](docs/ARCHITECTURE.md)
- [Estrategia competitiva y negocio](docs/STRATEGY.md)
- [Plan de lanzamiento y gates](docs/LAUNCH.md)

## Marca

`Cimbra` es un nombre de trabajo. Antes de invertir en adquisición, dominio o contratos debe completarse búsqueda marcaria y societaria en cada jurisdicción objetivo.
