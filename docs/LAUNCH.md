# Plan de lanzamiento

## Gate 0 — ya implementado

- marca y narrativa inicial;
- sitio responsive y captación persistente;
- documentación conectada a endpoints existentes;
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
- SDK TypeScript empaquetable con reintentos seguros y verificación de webhooks;
- imagen OCI standalone e infraestructura AWS reproducible y validada estáticamente.

## Gate 1 — design partners

- entrevistas con 15 compradores y 5 equipos técnicos;
- tres cartas de intención con caso de uso, volumen y mercado;
- pricing probado y modelo de margen por cliente;
- selección de Argentina y México como secuencia, no lanzamiento simultáneo;
- búsqueda marcaria, dominio y constitución societaria;
- verificación de email, recuperación de contraseña y MFA para roles privilegiados;
- data room con deck, cap table, presupuesto, riesgos y arquitectura.

## Gate 2 — piloto con fondos controlados

- sponsor bancario / PSP y contratos firmados;
- KYC/KYB, AML, sanciones y monitoreo con responsables definidos;
- ledger productivo independiente de proveedores;
- conciliación de tres vías: Cimbra, proveedor y banco;
- secrets/KMS, SIEM, backups, incident response y on-call;
- pentest y cierre de hallazgos críticos/altos;
- términos, privacidad, DPA, soporte y matriz regulatoria aprobados;
- límites bajos, allowlist y rollout por cohortes.

## Gate 3 — disponibilidad general

- dos proveedores homologados para rieles críticos o plan de contingencia contractual;
- SLO medidos durante al menos 90 días;
- conciliación automática con excepciones dentro de SLA;
- unit economics positivos por cohorte;
- soporte operativo 24/7 para eventos que mueven fondos;
- auditoría externa priorizada por demanda comercial.

## Criterios de no lanzamiento

No mover fondos si falta cualquiera de estos elementos: dueño regulatorio claro, segregación y safeguarding, ledger reproducible, conciliación independiente, plan de reversas, monitoreo de fraude, respuesta a incidentes, contrato con proveedor o límites operativos.

## Próximas decisiones ejecutivas

1. Elegir el wedge exacto y un país inicial.
2. Nombrar responsable legal/compliance con experiencia local.
3. Conseguir dos design partners antes de profundizar módulos secundarios.
4. Definir build-versus-partner por cada riel.
5. Fijar presupuesto de 18 meses y umbrales de contratación.
