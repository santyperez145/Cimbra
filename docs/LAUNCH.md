# Plan de lanzamiento

## Gate 0 — ya implementado

- marca y narrativa comercial orientada a compradores, con capacidades y límites verificables;
- sitio responsive, sesión contextual y captación persistente;
- portal developer conectado al OpenAPI real, con las 179 operaciones, parámetros, respuestas, búsqueda, quickstart ejecutable, límites del entorno sandbox y changelog;
- `GET /api/v1/live-readiness` y `/api/health` exponen sandbox vs production, etapas Pomelo Integración → Homologación → Go Live, productos del catálogo público, rieles oficiales (BCRA, Coelsa, banco patrocinante, PCI), el camino PSPCP y el envelope de USD 500 de Gate 1 (`capitalPlan`, gastado 0); `liveReady=false` porque no hay hostname, inscripción, riel live ni adaptador. Gastar ese presupuesto no marca Go Live.
- identidad y consola multi-tenant básica;
- registro e inicio de sesión propio, sesiones revocables y OAuth Google/Apple;
- sandbox persistente para customers, accounts, statements, book transfers, cards y transfers;
- ledger de doble partida con montos enteros, balances derivados y garantías en base de datos;
- idempotencia, holds, captura, liberación y reversas compensatorias;
- riesgo por monto demostrable;
- documentos privados en object storage;
- eventos de auditoría y readiness que falla cerrado ante esquema o secretos críticos inválidos;
- migraciones, lint, tipos y build automatizables.
- API pública v1 con request IDs, errores normalizados, rate-limit headers e idempotencia de altas;
- SDK TypeScript empaquetable y descargable con SHA-256, reintentos seguros y verificación de webhooks;
- imagen OCI standalone e infraestructura AWS reproducible; el build empaqueta assets públicos/compilados y CI levanta el proceso real para verificar por HTTP HTML, assets de Next.js y archivos públicos.
- estados globales responsive para rutas inexistentes y fallos recuperables, sin interceptar el redirect HTTP de sesión ni presentar una mutación financiera incierta como confirmada.
- métricas de overview calculadas en PostgreSQL para ventanas reales de 7 y 30 días, con selector funcional y actividad consistente con el período.
- migraciones versionadas como gate previo al build productivo de Vercel y como task separada antes del rollout de ECS.
- verificación de email, recuperación de contraseña con revocación de sesiones y MFA TOTP con recovery codes de un solo uso.
- miembros e invitaciones verificadas con roles owner/admin/operator/viewer, jerarquía, auditoría, webhooks y consola adaptada al permiso efectivo.
- matriz canónica de capacidades compartida por API y consola, redirección por sesión vencida y denegaciones de rol normalizadas como `403 insufficient_role`.
- motor de riesgo propio con políticas regionales, familias versionadas por tenant, champion/challenger, simulación sin impacto en vivo, métricas operativas, velocity, evaluaciones, step-up OTP con secretos protegidos e intentos append-only, p50/p95/p99 y cumplimiento del SLO de decisión, casos y resolución sincronizada con holds.
- conciliación propia de lotes contra el ledger con matches, diferencias, faltantes, cola de excepciones y resolución idempotente.
- importación CSV canónica y ciclos de settlement sandbox programables, únicos por conciliación y entregados por webhooks.
- disputas parciales nativas sobre débitos liquidados, con ventana y máquina de estados explícitas, crédito provisional/final en ledger, compensación contable, auditoría, webhooks, API, SDK y consola por rol; `network_ready` no implica presentación real ante una red.
- doble aprobación maker/checker configurable por separado para settlement, transferencias, lotes de payouts, casos de riesgo, excepciones de conciliación y disputas, con MFA, separación de personas, expiración, fallo explícito, historial, API/SDK de lectura, consola y ejecución transaccional sin bypass.
- cola operativa unificada para casos de riesgo, excepciones de conciliación y disputas, con asignación tenant-scoped, prioridad, SLA, escalamiento, comentarios, evidencia privada, API, SDK, consola, auditoría e idempotencia.
- beneficiarios protegidos y payouts masivos con lotes de hasta 100 ítems, maker/checker, agenda/deadline, worker recuperable, riesgo/ledger por ítem y archivo de resultados.
- book transfers internos con locks de origen/destino, saldo disponible, postings atómicos, riesgo/holds, maker/checker, reversas compensatorias, statements, API, SDK, eventos y consola por rol; no equivalen a un riel bancario externo.
- wallets nativas con programas tenant, wallets por customer, bolsillos ledger-backed, movimientos internos, freeze/close, API, SDK, eventos y consola por rol; no custodian fondos ni emiten una app de consumidor.
- pagos instantáneos sandbox para Argentina con CVU 0009999, alias tenant-scoped (asignar o cambiar sobre un CVU existente, un cambio real cada 24 h; eliminar el CVU no borra la cuenta ni el saldo), confirmación de titular, crédito interno o cash-out a settlement, débito interno, QR Cimbra dinámico, estático y de deuda con orden de venta, devoluciones, API, SDK, eventos y consola; no es Coelsa, DEBIN ni QR interoperable.
- cobranzas sandbox para Argentina con links de cobro, puntos de recaudación con CVU propio, eco cerrado entre cuentas Cimbra, inbound ledger y devoluciones compensatorias; no procesa tarjetas, POS ni QR interoperable.
- ECHEQ sandbox para Argentina con emisión, aceptación, endoso, depósito interno, anulación y devolución previa; no es Coelsa, CMC7, descuento ni compensación a 48 horas.
- customer due diligence KYC/KYB nativo con partes relacionadas, beneficiarios finales, policy snapshot, checks y evidencia append-only, expiración, API/SDK de orquestación, webhooks, consola por rol y aprobación humana maker/checker; no incluye biometría, consulta oficial ni habilitación regulatoria externa.
- infraestructura nativa de servicios con catálogo tenant, obligaciones emitidas, referencias de suscriptor protegidas, bill payments, recargas, gift cards, reversas compensatorias y mandatos recurrentes con consentimiento, límites, agenda, lease y reintentos; API, SDK, eventos y consola comparten ledger, riesgo, holds y RBAC. No incluye cobertura comercial, consulta externa o débito homologado.

## Gate 1 — design partners

Presupuesto autorizado: **USD 500**. Compra consulta legal del camino SAS/PSPCP, dominio y búsqueda marcaria, entrevistas a design partners y correo transaccional. No constituye sociedad, no inscribe el PSP (el trámite BCRA es gratuito pero exige persona jurídica), no paga Coelsa ni un banco patrocinante, no activa AWS pago y no marca Go Live.

El data room público vive en `/investors` y se deriva de `live-readiness`, el catálogo y el envelope. No hay clientes, volumen ni LOIs inventados.

- entrevistas con 15 compradores y 5 equipos técnicos;
- tres cartas de intención con caso de uso, volumen y mercado;
- pricing probado y modelo de margen por cliente;
- selección de Argentina y México como secuencia, no lanzamiento simultáneo;
- búsqueda marcaria, dominio y constitución societaria (esta última queda para el cheque siguiente);
- proveedor de email transaccional con dominio verificado y política que exija MFA a owners/admins fuera de sandbox;
- data room con deck, cap table, presupuesto, riesgos y arquitectura.

## Gate 2 — piloto con fondos controlados

- licencia aplicable o sponsor bancario/PSP y contratos de acceso al riel firmados;
- inscripción en el Registro de PSP del BCRA (y billeteras interoperables si corresponde) con evidencia en `official_rail_connections`;
- KYC/KYB, AML, sanciones y monitoreo con responsables definidos;
- ledger productivo autoritativo e independiente de bancos, cámaras y redes;
- conciliación de tres vías: Cimbra, banco/cámara y settlement;
- secrets/KMS, SIEM, backups, incident response y on-call;
- pentest y cierre de hallazgos críticos/altos;
- términos, privacidad, DPA, soporte y matriz regulatoria aprobados;
- límites bajos, allowlist y rollout por cohortes.

## Gate 3 — disponibilidad general

- conectividad directa homologada y plan de contingencia para cada riel crítico;
- SLO medidos durante al menos 90 días;
- conciliación automática con excepciones dentro de SLA;
- unit economics positivos por cohorte;
- soporte operativo 24/7 para eventos que mueven fondos;
- auditoría externa priorizada por demanda comercial.

## Criterios de no lanzamiento

No mover fondos si falta cualquiera de estos elementos: dueño regulatorio claro, segregación y safeguarding, ledger reproducible, conciliación independiente, plan de reversas, monitoreo de fraude, respuesta a incidentes, acceso contractual al riel o límites operativos.

## Próximas decisiones ejecutivas

1. Elegir el wedge exacto y un país inicial.
2. Nombrar responsable legal/compliance con experiencia local.
3. Conseguir dos design partners antes de profundizar módulos secundarios.
4. Definir licencia, sponsor y conectividad directa del primer riel sin incorporar plataformas competidoras.
5. Fijar presupuesto de 18 meses y umbrales de contratación.
