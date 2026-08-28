# Cimbra

Cimbra es una plataforma de infraestructura financiera modular para Latinoamérica. Este repositorio contiene el sitio comercial, documentación, consola autenticada y un sandbox persistente con cuentas conceptuales, transferencias, riesgo, compliance, almacenamiento de evidencia y auditoría.

## Estado del producto

La aplicación es un MVP lanzable para venta, discovery e integración en sandbox. No mueve fondos reales ni sustituye licencias, contratos con bancos patrocinadores, procesadores, redes de tarjetas o proveedores KYC/AML. La interfaz separa explícitamente sandbox y producción para evitar confusión.

Superficies disponibles:

- `/` — propuesta comercial y captación persistente de leads.
- `/developers` — quickstart y referencia de los endpoints implementados.
- `/login` — registro e inicio de sesión propio con usuario/email y contraseña, Google y Apple.
- `/console` — consola protegida con sesiones de servidor, organización y datos propios.
- `/api/health` — healthcheck sin caché.
- `/api/sandbox/*` — customers, accounts, cards, transfers y audit events.
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

La identidad de Cimbra usa PBKDF2-HMAC-SHA-256, sesiones opacas revocables en D1, cookies `HttpOnly`, protección de origen y límites de intentos. Los tokens y secretos OAuth nunca se guardan en el cliente ni en el repositorio.

## Infraestructura y despliegue

La aplicación corre de forma nativa sobre Cloudflare Workers, con D1 para datos relacionales y R2 para documentos privados.

1. Creá una base D1 y un bucket R2 en tu cuenta de Cloudflare.
2. Copiá `wrangler.example.jsonc` a `wrangler.jsonc` y reemplazá el ID de D1 y el dominio.
3. Cargá secretos con `wrangler secret put GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`.
4. Configurá `NEXT_PUBLIC_CIMBRA_PUBLIC_URL` en el entorno de build con el mismo dominio.
5. Ejecutá `npm run build` y `npm run deploy`.

Redirect URIs a registrar:

- Google: `https://TU_DOMINIO/api/auth/oauth/google/callback`
- Apple: `https://TU_DOMINIO/api/auth/oauth/apple/callback`

Apple requiere un Services ID asociado a una app habilitada para Sign in with Apple, además de Team ID, Key ID y una clave privada `.p8`. Para desarrollo local copiá `.dev.vars.example` a `.dev.vars`; esos archivos están ignorados por Git.

## Documentos de dirección

- [Arquitectura objetivo](docs/ARCHITECTURE.md)
- [Estrategia competitiva y negocio](docs/STRATEGY.md)
- [Plan de lanzamiento y gates](docs/LAUNCH.md)

## Marca

`Cimbra` es un nombre de trabajo. Antes de invertir en adquisición, dominio o contratos debe completarse búsqueda marcaria y societaria en cada jurisdicción objetivo.
