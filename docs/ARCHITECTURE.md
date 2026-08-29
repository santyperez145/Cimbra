# Arquitectura de producto y plataforma

## Principios

1. El ledger es la fuente de verdad, nunca el balance cacheado de un proveedor.
2. Toda mutación financiera es idempotente, auditable y autorizada en servidor.
3. Todos los dominios de producto son propios; sólo los bancos, cámaras, esquemas y fuentes reguladas se conectan detrás de puertos de red aislados.
4. Los flujos largos se orquestan con estados explícitos, compensaciones y reintentos seguros.
5. PII, secretos, fondos y telemetría viven en límites de seguridad separados.
6. Sandbox y producción tienen credenciales, datos, rieles y señales visuales distintas.

## Arquitectura del MVP alojado

La versión de este repositorio usa Next.js 16, React 19 y TypeScript sobre Vercel Functions. PostgreSQL administrado guarda usuarios, identidades externas, sesiones, tokens de acción hasheados, recovery codes hasheados, organizaciones, miembros, invitaciones, cuentas financieras, journals, postings, holds, reglas/evaluaciones/casos de riesgo, corridas/partidas/excepciones de conciliación, objetos sandbox, transacciones, leads, metadata documental y eventos; Vercel Blob privado conserva únicamente los bytes de evidencia. La identidad es propia y se resuelve en servidor: credenciales PBKDF2-HMAC-SHA-256, sesiones opacas revocables, OAuth 2.0/OIDC con Google y Apple, verificación de email y MFA TOTP RFC 6238.

Los flujos OAuth usan Authorization Code, `state`, nonce, PKCE en Google y validación de firma, issuer y audience contra JWKS. Los secretos viven sólo en variables cifradas del entorno. Las sesiones viajan en cookies `HttpOnly`, `Secure` y `SameSite`, mientras PostgreSQL conserva únicamente el hash SHA-256 del token. Los enlaces de email duran como máximo 24 horas, se invalidan al emitir uno nuevo y se consumen atómicamente. El TOTP usa pasos de 30 segundos, tolerancia de un paso, secreto de 160 bits cifrado con AES-256-GCM y rechazo del mismo paso ya utilizado; cada recovery code de 80 bits se consume en una única transacción. Un reset de contraseña revoca todas las sesiones y no elimina el segundo factor. Las restricciones únicas, claves foráneas, transacciones, idempotency keys y triggers diferidos protegen la integridad de los datos. El sandbox monetario guarda importes en unidades mínimas `BIGINT`, calcula los balances desde postings, impide mezclar monedas o tenants y sólo corrige operaciones mediante reversas compensatorias.

El alta de colaboradores usa invitaciones tenant-scoped con vencimiento, email normalizado y aceptación condicionada a identidad verificada. Un advisory lock por email serializa invitación, aceptación y creación de workspace para impedir membresías ambiguas. La jerarquía protege al owner, impide auto-remoción y evita que admins administren o creen otros admins. La consola deriva navegación y acciones del rol efectivo; viewer conserva lectura sin recibir CTAs mutantes.

Cada request operativo:

1. resuelve la identidad autenticada;
2. resuelve la organización en servidor;
3. valida y normaliza la entrada;
4. verifica pertenencia de recursos;
5. ejecuta una escritura idempotente;
6. registra el evento de auditoría;
7. devuelve una representación sin secretos ni PII completa.

La API pública se expone bajo `/api/v1`. Todas las respuestas incluyen un `X-Request-Id` estable y los consumidores S2S reciben sus límites en headers. Customers, accounts, cards y movimientos aceptan claves de idempotencia protegidas con advisory locks y constraints únicos por organización. El SDK TypeScript conserva request e idempotency IDs a través de reintentos seguros y expone errores tipados.

La infraestructura reproducible del piloto está en `infra/terraform/aws`: ALB/WAF, ECS Fargate en subredes privadas, PostgreSQL 16 Multi-AZ con PITR, KMS/Secrets Manager y CloudWatch. El outbox de PostgreSQL sigue siendo la cola durable autoritativa en esta etapa; EventBridge ejecuta el recovery dispatcher cada minuto, además del dispatch inmediato post-response.

El catálogo de capacidades propio expone por API, SDK y consola los dominios `cimbra_native`, sus interfaces y su disponibilidad verificable. No conserva conexiones ni credenciales de plataformas competidoras. La conectividad futura se limita al perímetro de bancos, cámaras, esquemas y fuentes reguladas, con secretos y redes aislados por riel. Ver [`OWN_PLATFORM.md`](OWN_PLATFORM.md).

Risk & Fraud evalúa transferencias y payments dentro de la transacción que crea el movimiento. Combina umbrales regionales de sistema, velocity por contraparte y reglas activas por tenant; persiste score, decisión, reglas coincidentes y razones. `review` crea un caso y hold vinculados, y resolver el caso captura o libera la reserva mediante la misma semántica idempotente del ledger. `decline` conserva la evaluación y el caso sin crear un movimiento contable.

Reconciliation toma partidas API o un CSV UTF-8 versionado por Idempotency-Key y las compara con movimientos `settled/reversed` del mismo tenant, moneda y período. El archivo crudo se valida en memoria y se descarta; quedan checksum, nombre seguro y partidas normalizadas. Cada partida queda como `matched`, `mismatch`, `missing_internal` o `missing_external`; las diferencias generan excepciones con resolución auditable. No modifica postings ni oculta breaks: una corrección financiera debe ingresar como operación compensatoria independiente.

Una conciliación `completed` puede originar un único ciclo de settlement sandbox. El ciclo conserva neto, diferencia, rail lógico, programación y ejecución idempotente. Cuando el tenant activa doble control, ejecutar no modifica el ciclo: crea una solicitud `pending`, con expiración e idempotencia, y exige un checker owner/admin con MFA distinto del maker. La aprobación, el settlement, la auditoría y el outbox se confirman en una misma transacción; rechazo, cancelación y expiración son estados terminales preservados. El dispatcher diario atraviesa el mismo orquestador y no puede eludir la política. Es una confirmación operativa de sandbox: los settlement instructions, el intercambio de archivos con rieles y el movimiento de fondos permanecen fuera hasta homologar conectividad directa.

El mismo motor protege `transfer.create` mediante una política separada y opt-in. La llamada API o la consola persisten la intención y devuelven `202` sin crear la transacción ni reservar fondos. Otro owner/admin con MFA aprueba desde sesión humana; bajo el lock de cuenta, Cimbra recalcula saldo disponible y riesgo y recién entonces crea el movimiento, hold/caso o postings. Saldo insuficiente o decline de riesgo deja la solicitud en `failed`, sin asiento parcial. Los locks de política son compartidos por las operaciones concurrentes y exclusivos para cambios de configuración, evitando tanto el bypass como la serialización global de transferencias.

Los deployments productivos de Vercel ejecutan las migraciones versionadas antes de compilar y publicar la nueva aplicación. Los previews no mutan la base compartida; ECS conserva una task definition de migración separada y el rollout exige su finalización correcta.

## Arquitectura objetivo para dinero real

El ledger actual es un núcleo financiero real para sandbox, pero no debe convertirse por crecimiento accidental en un core que mueva dinero. La plataforma de producción se separa en seis dominios desplegables:

- Identity & Tenancy: organizaciones, roles, permisos, claves, políticas y segregación.
- Financial Core: cuentas, ledger de doble partida, holds, límites, fees, intereses y cierres.
- Payment Orchestration: intents, routing, conectores directos a rieles, webhooks, conciliación y settlement.
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

## Ledger implementado

El sandbox ya impone:

- asientos balanceados por transacción;
- monedas sin mezcla de escalas;
- journals `posted` y `reversed`, transacciones con estados explícitos y vínculos de reversa;
- claves idempotentes por tenant y operación;
- prohibición de updates destructivos sobre asientos posteados;
- decisiones de riesgo persistidas y explicables antes de contabilizar;
- conciliaciones reproducibles con cola de excepciones y cierre explícito;
- importaciones con checksum y settlement sandbox sin doble ejecución;
- doble control maker/checker para settlement y transferencias, con identidad humana, MFA, separación de funciones, revalidación y decisión atómica;

Antes de dinero real todavía se requieren secuencia estable para extractos, conciliación independiente contra Cimbra, banco/cámara y settlement, cierres, snapshots, operación multi-región y controles regulatorios.

## Seguridad mínima para producción

- threat model por dominio y revisión independiente antes del piloto;
- MFA obligatorio para owners/admins antes de habilitar operaciones productivas de alto riesgo; el TOTP implementado sirve para el piloto y debe complementarse con WebAuthn resistente a phishing para disponibilidad general;
- RBAC/ABAC y segregación de funciones;
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
- p95 interno: menor a 250 ms, excluyendo bancos, cámaras y redes externas.
- RPO ledger: cercano a cero mediante replicación y journal durable.
- RTO crítico: menor a 60 minutos al piloto, menor a 15 minutos en enterprise.
- webhooks: entrega al menos una vez, firma, backoff y replay controlado.

Los SLO son objetivos de ingeniería; no deben publicarse como SLA contractual hasta medirlos en producción.
