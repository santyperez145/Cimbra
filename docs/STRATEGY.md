# Estrategia competitiva y negocio

## Tesis

La oportunidad es ofrecer una plataforma financiera regional propia que elimine la fragmentación entre core, pagos, emisión y procesamiento, acquiring, bill payments, lending, compliance y operación. Cimbra controla el producto, el modelo canónico, el ledger, la experiencia developer y la economía; los competidores se usan como benchmark, nunca como dependencia tecnológica.

## Lectura competitiva

### BIND / bindX

Fortaleza: banco, licencias, amplitud de APIs y llegada al ecosistema argentino. Cimbra debe igualar la cobertura de cuentas, transferencias, cobranzas y operación con un core regional propio; el acceso bancario se negocia directamente con entidades o cámaras habilitadas.

### Dock

Fortaleza: portafolio amplio de banking, cards, acquiring y fraude con operación a escala. Cimbra debe construir la misma amplitud modular, ganar en transparencia operativa y velocidad de integración y demostrar escala antes de convertir objetivos en SLA.

### tapi

Fortaleza: red regional de pagos de servicios y recargas, con foco y distribución. Cimbra construye su propio dominio de bill payments y obtiene cobertura mediante convenios directos con empresas y redes de origen, integrado a su ledger, riesgo y conciliación.

### Pismo

Fortaleza: core cloud-native, tarjetas, lending y clientes enterprise globales. Cimbra adopta el estándar de API extensa, eventos y batch, pero compite desde un core propio enfocado en Latinoamérica y una secuencia comercial disciplinada.

### Pomelo

Fortaleza: emisión y procesamiento de tarjetas, experiencia de integración y cobertura en América. Cimbra construye issuing, authorization y processing propios por etapas, con perímetro PCI/HSM separado y conexión directa a sponsor o esquemas certificados.

### Wibond

Fortaleza: propuesta white-label rápida con wallet, pagos y crédito. Cimbra debe superarla en profundidad developer, auditabilidad, configuración, controles enterprise y amplitud operativa sin perder time-to-market.

## Benchmark aplicado — riesgo y conciliación (28/08/2026)

El bloque sandbox actual iguala el patrón mínimo esperable de una infraestructura API-first: decisiones previas al posting, idempotencia por tenant, reglas configurables, velocity, score y razones persistidas, casos, resolución transaccional con holds, webhooks, SDK y una cola de excepciones de conciliación que detecta diferencias y faltantes en ambos sentidos.

La comparación oficial muestra, sin embargo, una brecha deliberadamente visible frente a productos maduros:

| Referencia | Patrón observado | Estado Cimbra | Decisión propia |
| --- | --- | --- | --- |
| BIND / bindX | OAuth2, rate limiting, cuentas y transferencias CBU/CVU 7x24 sobre riel bancario real | Contrato API, scopes, rate limit, ledger y transferencias sandbox | Conectar directamente el primer riel/sponsor; no usar bindX como dependencia |
| Dock | Antifraude transaccional en tiempo real, comportamiento/IA, background check, biometría, comunicación multicanal y operación 24x7 | Reglas determinísticas, velocity, casos y auditabilidad | Agregar señales, modelos evaluados, listas y step-up propios; no anunciar IA antes de tener datos y métricas |
| tapi | Una integración regional, sandbox, dashboard y soporte para bill payments, recargas y cash in/out | Developer platform uniforme, payments genéricos, consola y SDK; sin catálogo regional real | Construir billers y cash network mediante convenios directos por país |
| Pismo | Portal extenso, APIs, eventos real-time/batch, webhooks antifraude con presupuesto de latencia y reconciliación de clearing/DLQ | API v1, eventos firmados, decisión síncrona y conciliación por lote | Incorporar SLO de decisión, streaming/batch durable, replay operacional y reconciliación específica por riel |
| Pomelo | Idempotencia, autorización/ajustes, presentments asíncronos, remedios de fraude y archivos diarios de conciliación por SFTP | Idempotencia, holds/reversas, casos y comparación de lotes vía API | Crear ingestión propia de archivos, presentments/clearing y remedios con máquina de estados |
| Wibond | Wallet/finanzas embebidas de implementación rápida; el detalle técnico público no permite validar paridad endpoint por endpoint | Core y developer platform propios con mayor trazabilidad visible | Validar producto, SLA, cobertura y precios directamente durante diligence |

Prioridad de producto resultante:

1. Evolucionar la ingestión CSV/checksum y el scheduling sandbox ya disponibles hacia intercambio firmado, cierre y settlement por riel directo.
2. Agregar señales de dispositivo/identidad, listas, versionado de reglas, simulación, champion/challenger y métricas de falsos positivos.
3. Añadir asignación, SLA, evidencia, comentarios y doble control a casos y excepciones.
4. Publicar Postman, generación de SDKs adicionales, changelog y SLOs medidos; luego ejecutar homologación y certificaciones.

Ninguno de estos gaps autoriza conectar Cimbra con un competidor. Las únicas dependencias externas admisibles para operación real son bancos, cámaras, esquemas, redes, fuentes oficiales y sponsors regulados donde sean jurídicamente necesarios.

## Benchmark aplicado — identidad y operación por rol (28/08/2026)

Pismo documenta roles predefinidos por función, permission groups, acceso por organización, SSO y perfiles separados de operador, viewer, auditor y approver. Pomelo permite crear operadores, asignar roles y limitar pantallas y acciones, con alta por email y 2FA. Cimbra adopta ahora el núcleo propio necesario: invitaciones verificadas y vencibles, owner protegido, administración delegada sin escalamiento, operator mutante, viewer de lectura y eventos auditables. Owner/admin pueden actuar como checker bajo una política específica; roles personalizados, SSO empresarial y un perfil approver dedicado permanecen como evolución posterior y no se presentan como terminados.

## Benchmark aplicado — doble aprobación (29/08/2026)

Pismo publica un patrón maker/checker en el que una persona solicita, otra con rol autorizado decide y la operación no cambia el recurso hasta la aprobación; también documenta estados pendientes y terminales, expiración, historial y notificaciones para operaciones sensibles. BIND/bindX documenta OAuth 2.0 y permisos robustos para transferencias automatizadas, pero su material público consultado no alcanza para atribuirle un contrato maker/checker equivalente. No se encontraron contratos públicos suficientemente precisos de Dock, tapi, Pomelo o Wibond para afirmar paridad de doble aprobación endpoint por endpoint.

Cimbra implementa el patrón como propiedad propia para settlement y transferencias salientes sandbox: políticas independientes por tenant, maker y checker distintos, owner/admin con MFA para decidir, idempotencia, locks compartidos/exclusivos, expiración, rechazo, cancelación, fallo, auditoría, webhooks y ejecución atómica. El scheduler atraviesa el mismo control. Una transferencia pendiente no reserva fondos; al aprobar se recalculan saldo y riesgo y sólo entonces se crean ledger, hold o caso. Las integraciones S2S pueden originar una transferencia protegida y leer el historial con los scopes correspondientes, pero no aprobar ni rechazar. A diferencia del fallback documentado por Pismo ante ciertos fallos de su workflow, Cimbra falla cerrado y nunca ejecuta fuera de la política. Pismo mantiene hoy mayor cobertura —fondos retenidos, límites, tarjetas, credenciales, configuración y lending—; esas acciones, notificaciones específicas y un rol approver dedicado permanecen en el roadmap propio de Cimbra.

## Benchmark aplicado — narrativa comercial y acceso developer (29/08/2026)

Las superficies públicas de Pismo y Dock priorizan una promesa modular, una integración y amplitud de plataforma; tapi conecta esa promesa con casos de uso, sandbox y portal developer; Pomelo separa con claridad issuing, processing, sponsorship y requisitos de certificación; BIND PSP distingue staging/producción, OAuth 2.0 y permisos por scope. Cimbra adopta esos patrones de comprensión, no sus marcas ni contratos: hero orientado al resultado, catálogo modular con estado verificable, casos de uso por comprador, arquitectura de una integración, prueba técnica, documentación y CTA contextual.

La decisión propia es no fingir clientes, volumen, uptime, tiempos de integración ni conectividad. La landing usa evidencia que existe en el repositorio —API v1, OpenAPI, SDK, ledger, RBAC, maker/checker y webhooks— y etiqueta sandbox, foundation y roadmap. Los plazos comerciales se expresan como gates de fit, build, homologación y operación; producción sólo se presenta después de riel, contrato, licencia o sponsor, certificación, SLO y runbooks. El estado de sesión también es real: una persona autenticada abre su consola y una anónima ingresa o solicita una sesión de diseño.

## Wedge recomendado

Primer segmento: marketplaces, SaaS vertical y plataformas de workforce con volumen mensual entre USD 1M y USD 20M que necesitan cuentas virtuales, payouts, conciliación y tarjetas corporativas en Argentina y México.

Primer paquete vendible:

- ledger y cuentas virtuales;
- incoming payments y payouts;
- conciliación automática;
- KYB/KYC orquestado;
- consola operativa y webhooks;
- conectividad directa al riel inicial y contingencia operativa certificada.

Lending, acquiring y procesamiento profundo permanecen en el roadmap hasta validar distribución; siguen siendo producto futuro de Cimbra, no integraciones con esas plataformas.

## Modelo comercial

- fee de implementación por complejidad y jurisdicción;
- plataforma mensual por entorno, soporte y módulos;
- fee por cuenta activa o tarjeta activa;
- fee por transacción o basis points según riel;
- mínimos mensuales para cubrir soporte, compliance, redes, sponsors e infraestructura;
- pricing enterprise con SLA, residencia, reporting y soporte dedicados.

No subsidiar volumen indefinidamente. Cada contrato debe modelar margen de contribución por riel, costo de fondos, fraude, soporte, chargebacks, network/sponsor fees y costo regulatorio.

## Métricas de dirección

Producto: tiempo a primer request, tiempo a homologación, tasa de éxito, latencia, reintentos, errores por integración y adopción de módulos.

Operación: diferencias de conciliación, antigüedad de excepciones, falsos positivos, tiempo de resolución y pérdida por fraude.

Negocio: ARR, revenue retention, margen bruto por cliente, payback CAC, concentración, pipeline ponderado y burn multiple.

Riesgo: fondos no conciliados, exposición por sponsor/red, incidentes, hallazgos vencidos y cumplimiento de SLO.

## Objetivo de inversión

Una ronda pre-seed debe financiar 18 meses para cerrar el producto inicial, contratar seguridad/compliance, homologar dos rieles por mercado, ejecutar pilotos pagos y demostrar margen bruto defendible. Los hitos deben ser contratos y volumen conciliado, no sólo APIs construidas.

## Fuentes competitivas consultadas

- https://www.bindx.com/
- https://psp.bind.com.ar/developers
- https://psp.bind.com.ar/developers/general
- https://developers.bindx.com/transferencias-online-bind
- https://developers.bindx.com/consulta-de-cuentas-bind
- https://dock.tech/es/
- https://www.dock.tech/en/dock-one/
- https://dock.tech/es/solucao/fraud-prevention/
- https://tapi.la/
- https://www.tapila.dev/docs
- https://developers.pismo.io/pismo-docs/docs/welcome
- https://www.pismo.io/homepage/
- https://developers.pismo.io/pismo-docs/docs/main-solutions
- https://developers.pismo.io/pismo-docs/docs/anti-fraud-integration
- https://developers.pismo.io/pismo-docs/docs/security-guide-for-apis
- https://developers.pismo.io/pismo-docs/docs/get-started-with-sso-for-control-center
- https://developers.pismo.io/pismo-docs/docs/security-guide-for-control-center
- https://developers.pismo.io/pismo-docs/docs/control-center-access-profiles-and-roles
- https://developers.pismo.io/pismo-docs/docs/dual-approval
- https://developers.pismo.io/pismo-docs/changelog/6-march-2026
- https://developers.pismo.io/pismo-docs/docs/file-based-check-processing-and-bulk-settlement
- https://developers.pomelo.la/api-reference/processing/transactions
- https://www.pomelo.la/es/
- https://docs.pomelo.la/en/docs/cards/processing/reports/download-report
- https://developers.pomelo.la/guides/solutions/processing/reports
- https://developers.pomelo.la/api-reference/fraud/remedies/tx-remedy
- https://developers.pomelo.la/guides/dashboard/company/administration
- https://www.wibond.co/

La información pública cambia; validar métricas, cobertura, licencias y precios directamente en diligence antes de usarla en un pitch.
