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
    body: 'Desde Clientes das de alta personas o empresas con jurisdicción y un identificador fiscal. Cimbra guarda sólo el last4. El expediente KYC/KYB se abre en Compliance y no consulta AFIP ni un registro mercantil. Un cliente activo es el titular de cuentas, wallets y cobranzas del sandbox.',
  },
  {
    id: 'accounts',
    title: 'Cuentas de producto',
    summary: 'Una moneda por cuenta, ledger de doble partida y estado de cuenta de 30 días.',
    body: 'Desde Cuentas abrís una cuenta de producto para un cliente activo. El saldo sale de postings. El disponible resta holds. No es CBU, CVU ni una cuenta bancaria: el riel oficial exige Coelsa o un sponsor. Las correcciones se hacen con reversas, nunca mutando un asiento.',
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
    body: 'USD 500 cubre Gate 1 (consulta legal, dominio, entrevistas y correo). No constituye SAS, no paga Coelsa, no activa AWS ni marca Go Live. El data room público está en /investors.',
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
