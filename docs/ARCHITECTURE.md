# Arquitectura de producto y plataforma

## Principios

1. El ledger es la fuente de verdad, nunca el balance cacheado de un proveedor.
2. Toda mutación financiera es idempotente, auditable y autorizada en servidor.
3. Todos los dominios de producto son propios; sólo los bancos, cámaras, esquemas y fuentes reguladas se conectan detrás de puertos de red aislados.
4. Los flujos largos se orquestan con estados explícitos, compensaciones y reintentos seguros.
5. PII, secretos, fondos y telemetría viven en límites de seguridad separados.
6. Sandbox y live tienen credenciales, datos, rieles y señales visuales distintas. El contrato API es el mismo; live es un flip de entorno fail-closed.

El modo operativo efectivo se publica en `Cimbra-Environment` y en `/api/health`. `CIMBRA_OPERATING_MODE=live` no autoriza fondos: `evaluateLiveReadiness` exige evidencia y al menos un riel directo certificado (banco, cámara, esquema o sponsor). Sin eso el entorno efectivo permanece `sandbox` y no se emiten claves `cim_sk_live_`.

## Arquitectura del MVP alojado

La versión de este repositorio usa Next.js 16, React 19 y TypeScript sobre Vercel Functions. PostgreSQL administrado guarda usuarios, identidades externas, sesiones, tokens de acción hasheados, recovery codes hasheados, organizaciones, miembros, invitaciones, expedientes KYC/KYB con policy snapshot, partes, checks y lifecycle, cuentas de producto, wallets, programas y bolsillos, instrumentos de riel sandbox, transferencias instantáneas, QR de cobro, links de cobro, ECHEQ sandbox, book transfers, beneficiarios de payouts con destinos hasheados, lotes e ítems de payout, catálogos de billers, obligaciones, órdenes de servicio, mandatos y ejecuciones recurrentes, cuentas financieras, journals, postings, holds, familias/versiones/promociones/simulaciones de políticas de riesgo, evaluaciones, latencias de decisión, challenges step-up e intentos y casos, corridas/partidas/excepciones de conciliación, ownership y SLA operativos, comentarios y vínculos de evidencia, objetos sandbox, transacciones, leads, metadata documental y eventos; Vercel Blob privado conserva únicamente los bytes de evidencia. La identidad es propia y se resuelve en servidor: credenciales PBKDF2-HMAC-SHA-256, sesiones opacas revocables, OAuth 2.0/OIDC con Google y Apple, verificación de email y MFA TOTP RFC 6238.

Los flujos OAuth usan Authorization Code, `state`, nonce, PKCE en Google y validación de firma, issuer y audience contra JWKS. Los secretos viven sólo en variables cifradas del entorno. Las sesiones viajan en cookies `HttpOnly`, `Secure` y `SameSite`, mientras PostgreSQL conserva únicamente el hash SHA-256 del token. Los enlaces de email duran como máximo 24 horas, se invalidan al emitir uno nuevo y se consumen atómicamente. El TOTP usa pasos de 30 segundos, tolerancia de un paso, secreto de 160 bits cifrado con AES-256-GCM y rechazo del mismo paso ya utilizado; cada recovery code de 80 bits se consume en una única transacción. Un reset de contraseña revoca todas las sesiones y no elimina el segundo factor. Las restricciones únicas, claves foráneas, transacciones, idempotency keys y triggers diferidos protegen la integridad de los datos. El sandbox monetario guarda importes en unidades mínimas `BIGINT`, calcula los balances desde postings, impide mezclar monedas o tenants y sólo corrige operaciones mediante reversas compensatorias.

El alta de colaboradores usa invitaciones tenant-scoped con vencimiento, email normalizado y aceptación condicionada a identidad verificada. Un advisory lock por email serializa invitación, aceptación y creación de workspace para impedir membresías ambiguas. La jerarquía protege al owner, impide auto-remoción y evita que admins administren o creen otros admins. La consola deriva navegación y acciones del rol efectivo; viewer conserva lectura sin recibir CTAs mutantes.

La autorización humana se declara una sola vez como capacidades de negocio (`console.read`, `finance.write`, `risk.rules.manage`, `approvals.decide`, `credentials.manage`, entre otras). Las rutas API resuelven esas capacidades a roles y la consola reutiliza la misma matriz para navegación y acciones; el servidor siempre vuelve a validar. Las API keys permanecen gobernadas por scopes, no por roles humanos. Una sesión inexistente o vencida responde `401` y la consola vuelve a `/login` conservando `return_to`; una sesión válida sin capacidad responde `403 insufficient_role`, permanece autenticada y muestra el límite real en vez de confundirlo con un fallo del sistema.

El overview no presenta controles decorativos: sus ventanas de 7 y 30 días se agregan en PostgreSQL con un mismo instante de corte enviado a la consola. Volumen, tasa de aprobación, cantidad y actividad visible cambian juntos al seleccionar el período.

Cada request operativo:

1. resuelve la identidad autenticada;
2. resuelve la organización en servidor;
3. valida y normaliza la entrada;
4. verifica pertenencia de recursos;
5. ejecuta una escritura idempotente;
6. registra el evento de auditoría;
7. devuelve una representación sin secretos ni PII completa.

La API pública se expone bajo `/api/v1`. Todas las respuestas incluyen un `X-Request-Id` estable y los consumidores S2S reciben sus límites en headers. Customers, accounts, cards, book transfers y movimientos aceptan claves de idempotencia protegidas con advisory locks y constraints únicos por organización. El SDK TypeScript conserva request e idempotency IDs a través de reintentos seguros y expone errores tipados. OpenAPI 3.1 es el contrato canónico del portal para desarrolladores: una prueba compara cada handler real con su operación documentada y rechaza rutas faltantes o sobrantes. El SDK se distribuye como artefacto versionado con SHA-256; el portal distingue explícitamente las operaciones que todavía no son replay-idempotent y no las reintenta automáticamente.

La infraestructura reproducible del piloto está en `infra/terraform/aws`: ALB/WAF, ECS Fargate en subredes privadas, PostgreSQL 16 Multi-AZ con PITR, KMS/Secrets Manager y CloudWatch. El outbox de PostgreSQL sigue siendo la cola durable autoritativa en esta etapa; EventBridge ejecuta el recovery dispatcher cada minuto, además del dispatch inmediato post-response.

El catálogo de capacidades propio expone por API, SDK y consola los dominios `cimbra_native`, sus interfaces y su disponibilidad verificable. No conserva conexiones ni credenciales de plataformas competidoras. La conectividad futura se limita al perímetro de bancos, cámaras, esquemas y fuentes reguladas, con secretos y redes aislados por riel. Ver [`OWN_PLATFORM.md`](OWN_PLATFORM.md).

Risk & Fraud evalúa transferencias y payments dentro de la transacción que crea el movimiento. Combina umbrales regionales de sistema, velocity, listas `allow/watch/block`, señales derivadas de dispositivo/identidad/país y únicamente las versiones `champion` activas del tenant; persiste score, decisión, coincidencias, razones y latencia de decisión. Las referencias sensibles se normalizan y hashean con namespace del tenant antes de persistirse; API, auditoría, webhooks, aprobaciones y consola sólo reciben presencia y señales derivadas. Cada familia es inmutable por versión: una nueva versión nace `challenger`, puede compararse con la champion sobre hasta 50 muestras sin persistir datos crudos y sólo entra en vivo mediante una promoción idempotente. Una evaluación `review` admite un challenge OTP propio: la credencial se cifra con AES-GCM para replay seguro mientras está pendiente, se verifica contra PBKDF2, se elimina al llegar a estado terminal y cada intento queda append-only bajo lock, idempotencia, expiración y límite de intentos. El resultado se enlaza como evidencia del mismo caso, pero no lo resuelve ni elude maker/checker. Los outcomes legítimo/fraude son revisiones append-only: corregir exige señalar la versión activa reemplazada, conserva el historial y alimenta precisión, recall, falsos positivos y pérdida por moneda. El proxy de resoluciones permanece separado de esas métricas confirmadas. `review` crea un caso y hold vinculados; `decline` conserva la evaluación y el caso sin crear un movimiento contable. P50, p95, p99 y cumplimiento ≤250 ms se calculan sólo con evaluaciones nuevas que poseen medición persistida; son evidencia del sandbox, no un SLA contractual.

Card Issuing separa la configuración del programa, el instrumento, su lifecycle y sus controles. Los programas fijan producto, formatos y moneda; una tarjeta física nace `created`, una virtual `active`, y sólo transiciones autorizadas pueden moverla entre `active`, `frozen` y el terminal irreversible `terminated`. Cada cambio agrega un evento append-only con actor, motivo, idempotencia y webhook. Los límites por transacción/día/mes, canales y MCC se reemplazan como versiones completas e inmutables bajo lock de tarjeta; la moneda debe coincidir con la cuenta. El sandbox guarda únicamente `last4` sintético: no genera PAN/CVV, no tokeniza y no afirma aplicar controles en una autorización de red.

Reconciliation toma partidas API o un CSV UTF-8 versionado por Idempotency-Key y las compara con movimientos `settled/reversed` del mismo tenant, moneda y período. El archivo crudo se valida en memoria y se descarta; quedan checksum, nombre seguro y partidas normalizadas. Cada partida queda como `matched`, `mismatch`, `missing_internal` o `missing_external`; las diferencias generan excepciones con resolución auditable. No modifica postings ni oculta breaks: una corrección financiera debe ingresar como operación compensatoria independiente.

La work queue de Operaciones proyecta casos de riesgo y excepciones de conciliación sobre un contrato común, sin reemplazar sus tablas ni máquinas de estado. Los casos abiertos reciben un SLA inicial según prioridad; owner/admin/operator pueden asignar miembros del mismo tenant, re-priorizar, reprogramar o escalar. Comentarios y vínculos a documentos de Compliance son append-only, cada comando tiene Idempotency-Key y fingerprint, y la transacción confirma comando, expediente, auditoría y outbox. La relación polimórfica se valida en el servicio bajo lock porque PostgreSQL no puede expresar una foreign key a dos tablas; las constraints mantienen tenant, actores y documentos con claves explícitas.

Customer Due Diligence es un dominio propio, separado de riesgo transaccional. El tipo canónico del customer determina KYC o KYB; cada caso congela jurisdicción, versión de política y checks requeridos. Partes y observaciones se agregan únicamente en `draft`, la participación beneficiaria total se serializa bajo lock y no puede superar 100%, los checks son append-only y sólo vinculan evidencia del mismo tenant. Enviar exige cobertura completa y, para KYB, representante legal y beneficiario final. Aprobar exige que los últimos checks requeridos estén en `passed`, otro owner/admin con MFA y sesión humana; una API key puede orquestar y leer, pero nunca decidir. Vencimiento, rechazo y cancelación son terminales y conservan auditoría/outbox. El contrato no convierte una carga manual en verificación biométrica, consulta oficial ni aprobación regulatoria.

Bill Payments & Top-ups reutiliza el core financiero en vez de crear un ledger paralelo. Un owner/admin registra el convenio, el originador directo emite obligaciones y Cimbra persiste sólo un digest tenant-scoped y los últimos cuatro caracteres del suscriptor. Una orden bloquea la obligación bajo lock, pasa por saldo, riesgo y holds, y sólo marca deuda pagada al liquidar o capturar; liberar mantiene la deuda abierta y revertir crea postings compensatorios antes de reabrirla. Un índice parcial impide dos órdenes activas sobre la misma obligación. Los mandatos conservan consentimiento único, límite, frecuencia, intento y agenda; un lease durable evita ejecución concurrente, los reintentos mantienen la fecha lógica original para no derivar el calendario y una reanudación explícita reinicia su presupuesto. No hay consulta ficticia a un biller ni cobertura comercial hasta incorporar un originador y riel directos certificados.

Payouts usa el mismo core sin crear saldos paralelos. Owner/Admin registra un beneficiario; el destino normalizado se convierte en un digest tenant-scoped y sólo se conserva una vista de cuatro caracteres. Un lote contiene de 1 a 100 ítems inmutables, una cuenta/moneda, agenda opcional y deadline. Al enviarlo, la política `payout_batch.execute` puede detenerlo en maker/checker; sin ella, un worker con lease procesa cada ítem en una transacción corta, revalida beneficiario/cuenta/saldo, pasa por riesgo y genera un cash-out en el ledger. Un ítem en review queda enlazado al hold y su captura o liberación recompone el estado del lote; una reversa contable marca el ítem y recompone el agregado en la misma transacción. Fallos funcionales se aíslan por ítem; fallos transitorios reintentan hasta tres veces; el CSV se deriva de los resultados persistidos. El cron recupera lotes programados o leases vencidos, mientras `after()` reduce latencia sin ser la única garantía. Vercel Hobby limita ese sweep a una ejecución diaria; el EventBridge declarado para el runtime AWS lo ejecuta cada minuto cuando exista autorización de gasto.

Book Transfers mueve saldo exclusivamente entre dos cuentas de producto del mismo tenant y moneda. La creación toma locks determinísticos, calcula el balance desde postings, resta holds activos y somete la intención al mismo motor de riesgo. Una aprobación genera en un único journal el débito de la cuenta liability origen y el crédito de la cuenta liability destino; una revisión crea un hold sólo sobre el origen y su captura produce exactamente ese journal. La política `transfer.create` protege tanto transferencias salientes como book transfers, pero conserva `resource_type` para ejecutar el dominio correcto. La reversa usa el motor contable canónico y sincroniza el estado `book_transfers` dentro de la misma transacción. Los estados de cuenta consultan postings inmutables por cuenta/período y calculan apertura/cierre sobre la fuente de verdad, sin snapshots inventados.

Wallets no abre un ledger paralelo. Un programa tenant fija marca, monedas y kinds de bolsillo; abrir una wallet crea una cuenta de producto por pocket. Owner/Admin gobierna programas; Operator abre, congela o cierra wallets y mueve saldo entre pockets. Congelar o cerrar inactiva las cuentas subyacentes para que el book transfer genérico también falle cerrado. El cierre exige saldo cero y sin holds. El sandbox no custodia fondos ni publica una app de consumidor.

Instant Payments Argentina reutiliza el mismo ledger. Cimbra emite CVU sandbox (`000` + PSP `9999`) y alias únicos por tenant, asignables o cambiables sobre un CVU existente con un cambio real cada 24 h; eliminar el CVU lo deja inoperable sin borrar la cuenta ni el saldo. Un CBU externo se referencia, no se emite. El crédito confirma titular, liquida interno con dos postings o sale a settlement, y las devoluciones son compensatorias. El débito y el QR Cimbra sólo operan entre cuentas del tenant. No hay conexión a Coelsa ni directorio nacional.

Cobranzas reutiliza payments y el ledger. Un `payment_link` fija comercio, monto ARS, vencimiento y medios `internal` o `sandbox_inbound`. El cobro interno debita otra cuenta del tenant; el inbound acredita contra settlement. Tarjeta, POS y QR interoperable fallan cerrados. La reversa genérica queda bloqueada; el refund canónico genera postings opuestos.

Una conciliación `completed` puede originar un único ciclo de settlement sandbox. El ciclo conserva neto, diferencia, rail lógico, programación y ejecución idempotente. Cuando el tenant activa doble control, ejecutar no modifica el ciclo: crea una solicitud `pending`, con expiración e idempotencia, y exige un checker owner/admin con MFA distinto del maker. La aprobación, el settlement, la auditoría y el outbox se confirman en una misma transacción; rechazo, cancelación y expiración son estados terminales preservados. El dispatcher diario atraviesa el mismo orquestador y no puede eludir la política. Es una confirmación operativa de sandbox: los settlement instructions, el intercambio de archivos con rieles y el movimiento de fondos permanecen fuera hasta homologar conectividad directa.

El mismo motor protege `transfer.create` mediante una política separada y opt-in. La llamada API o la consola persisten la intención y devuelven `202` sin crear la transacción ni reservar fondos. Otro owner/admin con MFA aprueba desde sesión humana; bajo el lock de cuenta, Cimbra recalcula saldo disponible y riesgo y recién entonces crea el movimiento, hold/caso o postings. Saldo insuficiente o decline de riesgo deja la solicitud en `failed`, sin asiento parcial. Los locks de política son compartidos por las operaciones concurrentes y exclusivos para cambios de configuración, evitando tanto el bypass como la serialización global de transferencias.

Los deployments productivos de Vercel ejecutan las migraciones versionadas antes de compilar y publicar la nueva aplicación. Los previews no mutan la base compartida; ECS conserva una task definition de migración separada y el rollout exige su finalización correcta.

## Arquitectura objetivo para dinero real

El ledger actual es el núcleo financiero real. El host de despliegue sigue en sandbox, como BIND APIBANK, Pismo `sandbox.pismolabs.io` y Pomelo `sandbox.api.pomelo.la`. Production no tiene hostname: Pismo lo entrega el representante, BIND no publica la URL y Pomelo usa `api.pomelo.la` después de homologar. La plataforma de producción se separa en seis dominios desplegables:

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
- ownership, prioridad, SLA, comentarios y evidencia privada para la cola operativa;
- importaciones con checksum y settlement sandbox sin doble ejecución;
- doble control maker/checker para settlement, transferencias, casos de riesgo y excepciones de conciliación, con identidad humana, MFA, separación de funciones, revalidación y decisión atómica;
- KYC/KYB tenant-scoped con política versionada, beneficiarios finales, checks y evidencia append-only, expiración y decisión independiente;
- billers, obligaciones protegidas, órdenes y mandatos tenant-scoped conectados al ledger, riesgo, holds, compensaciones y scheduler con lease;
- beneficiarios protegidos y lotes de payouts inmutables con maker/checker, worker leased, riesgo/ledger por ítem y archivo de resultados;
- book transfers account-to-account con dos legs atómicos, holds, maker/checker, reversas compensatorias y statements paginados;
- wallets por customer con programas tenant, bolsillos mapeados a cuentas de producto, freeze/close e movimientos internos via book transfers;
- pagos instantáneos sandbox con CVU/alias (asignar o cambiar sobre un CVU existente, un cambio real cada 24 h; eliminar el CVU no toca cuenta ni saldo), confirmación de titular, crédito interno o cash-out, débito interno, QR Cimbra y returns compensatorios;
- cobranzas sandbox con links de cobro, eco cerrado, inbound ledger y refunds compensatorios;
- ECHEQ sandbox con emisión, aceptación, endoso, depósito interno, NSF y devolución previa, sin Coelsa ni CMC7;

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
