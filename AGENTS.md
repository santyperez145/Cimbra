# Cimbra — lineamientos obligatorios de producto e ingeniería

Estos lineamientos gobiernan todo cambio futuro en este repositorio.

## Misión y propiedad

- Cimbra debe convertirse en una plataforma regional de infraestructura financiera competitiva e invertible.
- BIND/bindX, Dock, tapi, Pismo, Pomelo y Wibond son benchmarks permanentes de producto, arquitectura, seguridad, operación y experiencia; nunca dependencias, proveedores, adaptadores ni destinos de contract tests.
- Las capacidades competitivas se implementan como propiedad intelectual y servicios nativos de Cimbra. Para dinero real sólo se admiten conexiones directas con bancos, cámaras, esquemas, redes, autoridades, fuentes oficiales o sponsors regulados cuando sean jurídicamente necesarios.
- No se aprovisionan recursos pagos de AWS hasta que el usuario autorice expresamente el gasto. Terraform debe permanecer reproducible y validado mientras tanto.

## Definición obligatoria de terminado

Una capacidad no está terminada por tener una pantalla o un endpoint aislado. Debe quedar, según corresponda:

1. modelada en el dominio canónico y persistida mediante una migración versionada;
2. protegida por aislamiento de tenant, RBAC, scopes, idempotencia y controles de concurrencia;
3. expuesta por API versionada y documentada en OpenAPI;
4. incluida en el SDK cuando sea una integración machine-to-machine;
5. conectada con auditoría, eventos/webhooks, ledger, riesgo y conciliación cuando afecte dinero u operación;
6. operable desde pantallas reales, responsive y específicas para todos los roles aplicables, con acciones ocultas o bloqueadas según permisos;
7. cubierta por pruebas de dominio, contratos propios y E2E relevante;
8. documentada con límites honestos de sandbox, foundation, roadmap o producción;
9. verificada con tests, typecheck, lint, build, OpenAPI, SDK, migraciones, Terraform y auditoría de dependencias antes del deploy.

## Arquitectura y calidad

- Comparar cada dominio con documentación oficial vigente de los benchmarks y registrar la decisión propia; no copiar código, contratos privados, marcas ni propiedad intelectual.
- Mantener un modelo API-first y event-driven: REST para comandos/consultas, webhooks o streams para cambios y archivos firmados para procesos batch. ISO 8583 queda limitado al perímetro de tarjetas.
- PostgreSQL y el ledger de doble partida son la fuente de verdad; las correcciones financieras usan compensaciones, nunca mutación destructiva de postings.
- Evitar funciones, tablas, rutas y pantallas duplicadas. Antes de crear algo, buscar y extender el módulo canónico existente.
- No simular integraciones ni declarar productivo lo que carece de riel, contrato, licencia, certificación, SLO y evidencia operativa.
- Priorizar seguridad, trazabilidad, segregación de funciones, doble control, reconciliación y recuperación ante fallos sobre amplitud superficial.

## Producto y experiencia por rol

- Owner: gobierno del tenant, seguridad, miembros, políticas, credenciales y visibilidad total.
- Admin: administración delegada y configuración dentro de límites que no permitan desplazar al owner.
- Operator: ejecución y resolución operativa sin facultades de gobierno o escalamiento de privilegios.
- Viewer: lectura y auditoría sin acciones mutantes.
- Cada navegación, CTA, formulario, estado vacío, error, confirmación y vista móvil debe corresponder a datos y acciones reales. No usar controles decorativos que aparenten funcionalidad.

## Disciplina ejecutiva

- Mantener una matriz competitiva y un backlog por gates comerciales, regulatorios y técnicos.
- Elegir tecnología por confiabilidad, seguridad, costo total y capacidad del equipo; usar arquitectura equivalente a los líderes sólo cuando el volumen o el riesgo la justifique.
- Preservar capital: ningún servicio cloud o proveedor pago se activa sin presupuesto y autorización, pero su infraestructura declarativa debe quedar preparada.
