export const HELP_ARTICLES = [
  {
    id: 'sandbox',
    title: 'Qué es el sandbox y qué no mueve',
    summary: 'El host activo es sandbox. El ledger es real; los rieles oficiales no.',
    body: 'Cimbra ejecuta un core propio con ledger de doble partida, RBAC y APIs versionadas. liveReady permanece en falso hasta hostname de producción, producto en Go Live, riel oficial live y adaptador Cimbra. BIND, Dock, tapi, Pismo, Pomelo y Wibond son benchmarks, nunca conectores.',
  },
  {
    id: 'roles',
    title: 'Roles del tenant',
    summary: 'Owner, admin, operator y viewer comparten una matriz canónica entre API y consola.',
    body: 'Owner gobierna el tenant. Admin configura sin desplazar al owner. Operator ejecuta. Viewer sólo lee. Las acciones no autorizadas se ocultan y el servidor las vuelve a validar. Nadie se autoasigna owner.',
  },
  {
    id: 'customers',
    title: 'Padrón de clientes',
    summary: 'Personas y empresas del tenant. El last4 fiscal se persiste; no hay consulta oficial.',
    body: 'Desde Clientes das de alta personas o empresas con jurisdicción y un identificador fiscal. Cimbra guarda sólo el last4. El expediente KYC/KYB se abre en Compliance y no consulta AFIP ni un registro mercantil. Sin un expediente aprobado y vigente no se pueden abrir cuentas ni wallets.',
  },
  {
    id: 'accounts',
    title: 'Cuentas de producto',
    summary: 'Una moneda por cuenta, ledger de doble partida y estado de cuenta de 30 días.',
    body: 'Desde Cuentas abrís una cuenta de producto para un cliente con KYC/KYB aprobado. Si falta el expediente, la API responde 409 customer_kyc_required. El saldo sale de postings. El disponible resta holds. No es CBU, CVU ni una cuenta bancaria: el riel oficial exige Coelsa o un sponsor. Las correcciones se hacen con reversas, nunca mutando un asiento.',
  },
  {
    id: 'ledger',
    title: 'Libro mayor',
    summary: 'Saldos, journals y holds en sólo lectura.',
    body: 'Ledger consulta GET /api/v1/ledger. Ves saldos por moneda, journals recientes y holds activos. Owner/admin/operator con risk.cases.resolve pueden capturar o liberar holds desde esta pantalla. Los journals no se editan: las correcciones viven en reversas de transferencias, book transfers, payments o cobranzas.',
  },
  {
    id: 'audit',
    title: 'Registro de auditoría',
    summary: 'Eventos append-only del tenant. Se consultan; no se editan.',
    body: 'Auditoría lista GET /api/v1/events: acción, recurso, timestamp y payload. El log es inmutable y queda aislado por organización. No es un SIEM, no se presenta ante un regulador y no sustituye el historial de webhooks de Developers.',
  },
  {
    id: 'transfers',
    title: 'Movimientos y transferencias',
    summary: 'Listado paginado del API, alta idempotente y reversas compensatorias.',
    body: 'Movimientos opera GET/POST /api/v1/transfers y la reversa compensatoria. No es un book transfer entre cuentas ni un pago Coelsa. Un monto alto puede exigir maker/checker en Aprobaciones. Viewer lee y exporta; no crea ni revierte.',
  },
  {
    id: 'book-transfers',
    title: 'Book transfers',
    summary: 'Movimiento atómico entre dos cuentas Cimbra de la misma moneda.',
    body: 'Book transfers debita y acredita en un solo journal. Puede exigir aprobación. Distinto de cash-in/out (contra settlement interno) y de Pagos AR (instrumentos locales). No sale a Coelsa.',
  },
  {
    id: 'cash-payments',
    title: 'Cash-in y cash-out',
    summary: 'Payments de sandbox contra una cuenta de producto.',
    body: 'Cash-in/out usa POST /api/v1/payments. Contabiliza ingreso o egreso contra la cuenta de settlement interna. No llama bancos ni BaaS competidores. El historial se lee de journals cash_in/cash_out.',
  },
  {
    id: 'wallets',
    title: 'Wallets y bolsillos',
    summary: 'Programas, wallets y movimientos entre pockets del tenant.',
    body: 'Wallets modela bolsillos ledger-backed. Congelar o cerrar es un lifecycle propio. No es una billetera interoperable BCRA hasta el riel oficial correspondiente.',
  },
  {
    id: 'collections',
    title: 'Cobranzas',
    summary: 'Links, QR Cimbra, tills y eco cerrado en sandbox.',
    body: 'Cobranzas opera payment links, QR dinámico/estático/deuda y collection tills con CVU sandbox. No es POS, EMVCo ni PCT Coelsa. Las devoluciones son compensatorias.',
  },
  {
    id: 'pagos-ar',
    title: 'Pagos AR',
    summary: 'Instrumentos locales sandbox: CVU, alias, DEBIN e instant transfers internos.',
    body: 'Pagos AR usa el riel sandbox Cimbra (prefijo 0009999). No consulta el directorio nacional ni mueve Transferencias 3.0 reales. Live exige Coelsa u otro riel oficial.',
  },
  {
    id: 'echeq',
    title: 'ECHEQ sandbox',
    summary: 'Ciclo de emisión, aceptación y depósito interno.',
    body: 'ECHEQ en consola es payload cimbra:echeq:v1. No hay CMC7 ni compensación de cámara. Cesión y descuento quedan fuera hasta el riel Coelsa.',
  },
  {
    id: 'payouts',
    title: 'Payouts y lotes',
    summary: 'Beneficiarios y lotes asíncronos con doble control.',
    body: 'Payouts registra beneficiarios y lotes. La ejecución puede pedir aprobación. El archivo de resultados es sandbox; no liquida un banco real.',
  },
  {
    id: 'risk',
    title: 'Riesgo y holds',
    summary: 'Reglas versionables, casos y reservas de fondos.',
    body: 'Riesgo evalúa montos y señales. Un hold resta del disponible hasta capturar o liberar. Las reglas las gestionan owner/admin; operator resuelve casos.',
  },
  {
    id: 'support',
    title: 'Cómo abrir un caso de soporte',
    summary: 'Los tickets viven en el tenant y también los ve la superadministración de Cimbra.',
    body: 'Desde Soporte creá un caso con categoría y un mensaje accionable. El historial es append-only. Un operador de plataforma responde si está provisionado con CIMBRA_PLATFORM_OPERATOR_EMAILS. Esto no es un chat de red ni un SLA comercial.',
  },
  {
    id: 'pspcp',
    title: 'Camino PSPCP y dinero real',
    summary: 'La inscripción BCRA es gratuita, pero exige persona jurídica y banco patrocinante.',
    body: 'USD 500 cubre Gate 1 (consulta legal, dominio, entrevistas y correo). No constituye SAS, no paga Coelsa ni el retainer del banco patrocinante, no activa AWS ni marca Go Live. BIND Banco puede ser el sponsor regulado; bindX no es el producto. El data room público está en /investors y la evidencia del sponsor se opera en /ops.',
  },
  {
    id: 'api-keys',
    title: 'API keys y webhooks',
    summary: 'Las claves se muestran una sola vez. Los webhooks se firman.',
    body: 'Creá claves en Developers con scopes mínimos. cim_sk_live_ permanece reservado. Los secretos de webhook no se vuelven a mostrar. El portal /developers genera la referencia desde OpenAPI.',
  },
] as const;

export const STATUS_SURFACES = [
  { id: 'api', name: 'API y consola', href: '/api/health' },
  { id: 'docs', name: 'Contrato OpenAPI', href: '/developers' },
  { id: 'help', name: 'Centro de ayuda', href: '/help' },
  { id: 'investors', name: 'Data room', href: '/investors' },
] as const;
