# Plan de lanzamiento

## Gate 0 — ya implementado

- marca y narrativa comercial orientada a compradores, con capacidades y límites verificables;
- sitio responsive, sesión contextual y captación persistente;
- portal developer conectado al OpenAPI real, con las 61 operaciones, parámetros, respuestas, búsqueda, quickstart ejecutable, límites del sandbox y changelog;
- identidad y consola multi-tenant básica;
- registro e inicio de sesión propio, sesiones revocables y OAuth Google/Apple;
- sandbox persistente para customers, accounts, cards y transfers;
- ledger de doble partida con montos enteros, balances derivados y garantías en base de datos;
- idempotencia, holds, captura, liberación y reversas compensatorias;
- riesgo por monto demostrable;
- documentos privados en object storage;
- eventos de auditoría y healthcheck;
- migraciones, lint, tipos y build automatizables.
- API pública v1 con request IDs, errores normalizados, rate-limit headers e idempotencia de altas;
- SDK TypeScript empaquetable y descargable con SHA-256, reintentos seguros y verificación de webhooks;
- imagen OCI standalone e infraestructura AWS reproducible y validada estáticamente.
- migraciones versionadas como gate previo al build productivo de Vercel y como task separada antes del rollout de ECS.
- verificación de email, recuperación de contraseña con revocación de sesiones y MFA TOTP con recovery codes de un solo uso.
- miembros e invitaciones verificadas con roles owner/admin/operator/viewer, jerarquía, auditoría, webhooks y consola adaptada al permiso efectivo.
- matriz canónica de capacidades compartida por API y consola, redirección por sesión vencida y denegaciones de rol normalizadas como `403 insufficient_role`.
- motor de riesgo propio con políticas regionales, reglas por tenant, velocity, evaluaciones, casos y resolución sincronizada con holds.
- conciliación propia de lotes contra el ledger con matches, diferencias, faltantes, cola de excepciones y resolución idempotente.
- importación CSV canónica y ciclos de settlement sandbox programables, únicos por conciliación y entregados por webhooks.
- doble aprobación maker/checker configurable por separado para settlement y transferencias, con MFA, separación de personas, expiración, fallo explícito, historial, API/SDK de lectura, consola y ejecución transaccional sin bypass.

## Gate 1 — design partners

- entrevistas con 15 compradores y 5 equipos técnicos;
- tres cartas de intención con caso de uso, volumen y mercado;
- pricing probado y modelo de margen por cliente;
- selección de Argentina y México como secuencia, no lanzamiento simultáneo;
- búsqueda marcaria, dominio y constitución societaria;
- proveedor de email transaccional con dominio verificado y política que exija MFA a owners/admins fuera de sandbox;
- data room con deck, cap table, presupuesto, riesgos y arquitectura.

## Gate 2 — piloto con fondos controlados

- licencia aplicable o sponsor bancario/PSP y contratos de acceso al riel firmados;
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
