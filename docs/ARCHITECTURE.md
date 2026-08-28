# Arquitectura de producto y plataforma

## Principios

1. El ledger es la fuente de verdad, nunca el balance cacheado de un proveedor.
2. Toda mutación financiera es idempotente, auditable y autorizada en servidor.
3. Los proveedores externos se conectan mediante adaptadores; el dominio no depende de sus modelos.
4. Los flujos largos se orquestan con estados explícitos, compensaciones y reintentos seguros.
5. PII, secretos, fondos y telemetría viven en límites de seguridad separados.
6. Sandbox y producción tienen credenciales, datos, rieles y señales visuales distintas.

## Arquitectura del MVP alojado

La versión de este repositorio usa React 19, TypeScript, Vinext/Vite, Cloudflare Workers, D1 y R2. La identidad es propia y se resuelve en servidor: credenciales PBKDF2-HMAC-SHA-256, sesiones opacas revocables y OAuth 2.0/OIDC con Google y Apple. D1 guarda usuarios, identidades externas, sesiones, organizaciones, miembros, objetos sandbox, transacciones, leads, documentos y eventos; R2 guarda únicamente los bytes de evidencia.

Los flujos OAuth usan Authorization Code, `state`, nonce, PKCE en Google y validación de firma/issuer/audience contra JWKS. Los secretos viven sólo como bindings cifrados del entorno. Las sesiones viajan en cookies `HttpOnly`, `Secure` y `SameSite`, mientras D1 conserva únicamente el hash SHA-256 del token.

Cada request operativo:

1. resuelve la identidad autenticada;
2. resuelve la organización en servidor;
3. valida y normaliza la entrada;
4. verifica pertenencia de recursos;
5. ejecuta una escritura idempotente;
6. registra el evento de auditoría;
7. devuelve una representación sin secretos ni PII completa.

## Arquitectura objetivo para dinero real

El MVP no debe convertirse por crecimiento accidental en un core productivo. La plataforma de producción se separa en seis dominios desplegables:

- Identity & Tenancy: organizaciones, roles, permisos, claves, políticas y segregación.
- Financial Core: cuentas, ledger de doble partida, holds, límites, fees, intereses y cierres.
- Payment Orchestration: intents, routing, adapters, webhooks, conciliación y settlement.
- Cards & Lending: emisión/procesamiento y ciclo de crédito como dominios separados.
- Risk & Compliance: KYC/KYB, screening, rules engine, casos, evidencia y reportes.
- Platform: API gateway, event bus, workflows, observabilidad, developer portal y billing.

Stack de referencia para la etapa productiva:

- Go o Kotlin para servicios de dominio transaccional; TypeScript para BFF y herramientas.
- PostgreSQL administrado con réplicas, point-in-time recovery y particionado por volumen.
- Kafka o Redpanda para eventos; Temporal para workflows durables.
- Redis sólo para rate limits, locks acotados y caché no autoritativa.
- Kubernetes administrado cuando la complejidad operativa lo justifique; antes, contenedores administrados.
- OpenTelemetry, métricas RED/USE, trazas con correlation IDs y SIEM centralizado.
- Vault/KMS/HSM para claves, tokenización y material criptográfico.

## Ledger

El ledger productivo debe imponer:

- asientos balanceados por transacción;
- monedas sin mezcla de escalas;
- estados `pending`, `posted`, `reversed` y vínculos de reversa;
- claves idempotentes por tenant y operación;
- secuencia estable para extractos;
- prohibición de updates destructivos sobre asientos posteados;
- conciliación independiente contra cada proveedor y cuenta bancaria;
- cierres y snapshots reproducibles desde el journal.

## Seguridad mínima para producción

- threat model por dominio y revisión independiente antes del piloto;
- MFA y recuperación de cuenta antes de habilitar operaciones productivas de alto riesgo;
- MFA fuerte, RBAC/ABAC y segregación de funciones;
- cifrado en tránsito y reposo con rotación de claves;
- tokenización de datos de tarjeta y alcance PCI minimizado;
- SAST, DAST, dependency scanning, secret scanning y SBOM en CI;
- backups restaurados en pruebas periódicas;
- plan de respuesta, on-call y ejercicios de incidente;
- pentest previo al go-live y programa continuo de vulnerabilidades;
- evidencia para SOC 2 / ISO 27001 según mercado y clientes;
- retención y residencia de datos definidas por jurisdicción.

## SLO iniciales

- API transaccional: 99,95% al piloto; objetivo 99,99% al escalar.
- p95 interno: menor a 250 ms, excluyendo proveedor externo.
- RPO ledger: cercano a cero mediante replicación y journal durable.
- RTO crítico: menor a 60 minutos al piloto, menor a 15 minutos en enterprise.
- webhooks: entrega al menos una vez, firma, backoff y replay controlado.

Los SLO son objetivos de ingeniería; no deben publicarse como SLA contractual hasta medirlos en producción.
