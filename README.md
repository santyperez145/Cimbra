# Cimbra

Cimbra es una plataforma de infraestructura financiera modular para Latinoamérica. Este repositorio contiene el sitio comercial, documentación, consola autenticada y un sandbox persistente con cuentas conceptuales, transferencias, riesgo, compliance, almacenamiento de evidencia y auditoría.

## Estado del producto

La aplicación es un MVP lanzable para venta, discovery e integración en sandbox. No mueve fondos reales ni sustituye licencias, contratos con bancos patrocinadores, procesadores, redes de tarjetas o proveedores KYC/AML. La interfaz separa explícitamente sandbox y producción para evitar confusión.

Superficies disponibles:

- `/` — propuesta comercial y captación persistente de leads.
- `/developers` — quickstart y referencia de los endpoints implementados.
- `/console` — consola protegida con identidad, organización y datos propios.
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

## Documentos de dirección

- [Arquitectura objetivo](docs/ARCHITECTURE.md)
- [Estrategia competitiva y negocio](docs/STRATEGY.md)
- [Plan de lanzamiento y gates](docs/LAUNCH.md)

## Marca

`Cimbra` es un nombre de trabajo. Antes de invertir en adquisición, dominio o contratos debe completarse búsqueda marcaria y societaria en cada jurisdicción objetivo.
