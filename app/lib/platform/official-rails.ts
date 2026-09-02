import { PlatformRailError } from './operating-mode.ts';
import {
  dueDiligenceProgress, emptyOfficialRailEvidence, sponsorBankDocumentaryReady,
  type OfficialRailEvidence,
} from './sponsor-bank.ts';

export const RAIL_CONNECTION_STATUSES = ['unwired', 'negotiating', 'contracted', 'certified', 'live'] as const;
export type RailConnectionStatus = typeof RAIL_CONNECTION_STATUSES[number];

export const RAIL_COUNTERPARTY_KINDS = [
  'clearing_house', 'bank', 'card_scheme', 'official_registry', 'regulated_sponsor', 'corporate',
] as const;
export type RailCounterpartyKind = typeof RAIL_COUNTERPARTY_KINDS[number];

export const RAIL_CONNECTION_KINDS = [
  'corporate',
  'regulatory_registry',
  'safeguarding',
  'directory',
  'instant_credit',
  'instant_debit',
  'echeq_clearing',
  'cvu_assignment',
  'qr_pct',
  'card_issuing',
  'bill_payments',
] as const;
export type RailConnectionKind = typeof RAIL_CONNECTION_KINDS[number];

/**
 * Contrapartes oficiales para dinero real. Nunca competidores.
 * El adaptador de cada id se registra en OFFICIAL_RAIL_ADAPTERS cuando exista
 * contrato, certificación y código; hasta entonces dispatch falla cerrado.
 */
export type OfficialRailDefinition = {
  id: string;
  name: string;
  country: 'AR' | 'LATAM';
  kind: RailConnectionKind;
  counterpartyKind: RailCounterpartyKind;
  counterparty: string;
  officialUrl: string;
  summary: string;
  wiringContract: string;
  productIds: readonly string[];
};

export const OFFICIAL_RAIL_CONNECTIONS: readonly OfficialRailDefinition[] = [
  {
    id: 'legal_entity_ar', name: 'Sociedad regularmente constituida en la Argentina',
    country: 'AR', kind: 'corporate', counterpartyKind: 'corporate',
    counterparty: 'Persona jurídica constituida en el país',
    officialUrl: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
    summary: 'El BCRA exige constitución regular en la Argentina para operar como PSP. No hay socket que cablear: es un gate societario.',
    wiringContract: 'Evidencia societaria y objeto social. Sin adaptador de red.',
    productIds: ['account_lookup', 'transfers', 'debin', 'echeq', 'cvu', 'qr_interoperable', 'collections', 'card_issuing', 'bill_payments'],
  },
  {
    id: 'bcra_psp_registry', name: 'Registro BCRA de proveedores de servicios de pago',
    country: 'AR', kind: 'regulatory_registry', counterpartyKind: 'official_registry',
    counterparty: 'BCRA / SEFyC',
    officialUrl: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
    summary: 'Inscripción ante SEFyC con Clave Fiscal, certificado de inscripción y número RPSP. El BCRA da seis meses para iniciar operaciones.',
    wiringContract: 'Número RPSP y certificado. No es un riel de fondos; habilita a operar las funciones inscriptas.',
    productIds: ['account_lookup', 'transfers', 'debin', 'echeq', 'cvu', 'qr_interoperable', 'collections', 'bill_payments'],
  },
  {
    id: 'bcra_interoperable_wallets', name: 'Registro de billeteras digitales interoperables',
    country: 'AR', kind: 'regulatory_registry', counterpartyKind: 'official_registry',
    counterparty: 'BCRA / SEFyC',
    officialUrl: 'https://www.bcra.gob.ar/inscripcion-registro-billeteras-digitales-interoperables/',
    summary: 'Registro adicional si Cimbra inicia pagos como billetera interoperable. La aceptación de QR exige además la certificación del administrador del esquema.',
    wiringContract: 'Habilitación en el registro y certificados de interoperabilidad emitidos por el administrador del esquema.',
    productIds: ['qr_interoperable'],
  },
  {
    id: 'sponsor_bank', name: 'Banco patrocinante PSPCP',
    country: 'AR', kind: 'safeguarding', counterpartyKind: 'bank',
    counterparty: 'Entidad financiera patrocinante',
    officialUrl: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
    summary: 'Para inscribirse como PSPCP el BCRA exige informar el o los bancos patrocinantes, los servicios de pago y los modos de restitución de fondos. La identidad del banco (p. ej. una EF regulada candidata) vive en la evidencia persistida, no en este catálogo genérico.',
    wiringContract: 'Contrato de patrocinio y cuentas a la vista del sponsor. Credenciales y host quedan fuera del ledger. El adaptador es documental: no despacha fondos ni usa APIs de BaaS competidores.',
    productIds: ['account_lookup', 'transfers', 'debin', 'echeq', 'cvu', 'qr_interoperable', 'collections'],
  },
  {
    id: 'client_safeguarding', name: 'Fondos de clientes segregados',
    country: 'AR', kind: 'safeguarding', counterpartyKind: 'bank',
    counterparty: 'Cuenta a la vista de fondos de clientes',
    officialUrl: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
    summary: 'Los fondos acreditados en cuentas de pago deben estar disponibles de inmediato e individualizados. La cuenta operativa de Cimbra es distinta de la de clientes.',
    wiringContract: 'Cuentas bancarias segregadas y conciliación de tres vías. Sin mutación destructiva del ledger Cimbra.',
    productIds: ['transfers', 'cvu', 'collections'],
  },
  {
    id: 'coelsa_directory', name: 'Directorio CBU, CVU y Alias',
    country: 'AR', kind: 'directory', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa',
    officialUrl: 'https://www.coelsa.com.ar/',
    summary: 'Consulta de titular y alta de alias sobre el directorio nacional. El sandbox Cimbra no consulta esta red.',
    wiringContract: 'API o archivo firmado de directorio. La llamada de red ocurre fuera de la transacción SQL del ledger.',
    productIds: ['account_lookup', 'transfers', 'cvu'],
  },
  {
    id: 'coelsa_transfers', name: 'Transferencias 3.0',
    country: 'AR', kind: 'instant_credit', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa',
    officialUrl: 'https://www.coelsa.com.ar/',
    summary: 'Crédito inmediato contra CBU/CVU/Alias reales. Irreversible al completar en cámara.',
    wiringContract: 'Instrucción de transferencia, acuses y returns. No abrir SQL durante la llamada a cámara.',
    productIds: ['transfers', 'collections'],
  },
  {
    id: 'coelsa_debin', name: 'DEBIN',
    country: 'AR', kind: 'instant_debit', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa',
    officialUrl: 'https://www.coelsa.com.ar/',
    summary: 'Débito inmediato contra CBU/CVU externo, adhesión y vencimiento en el proveedor de la cuenta del pagador.',
    wiringContract: 'Alta de vendedor, pedido de débito y respuesta del banco o PSP del pagador.',
    productIds: ['debin'],
  },
  {
    id: 'coelsa_echeq', name: 'ECHEQ de cámara',
    country: 'AR', kind: 'echeq_clearing', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa',
    officialUrl: 'https://www.coelsa.com.ar/',
    summary: 'ECHEQ compensable: ID de cámara, depósito en cuenta corriente, cesión y descuento. El payload cimbra:echeq:v1 no es CMC7.',
    wiringContract: 'Mensajería ECHEQ Coelsa. El ledger Cimbra sólo asienta después del acuse o con compensación explícita.',
    productIds: ['echeq'],
  },
  {
    id: 'coelsa_cvu', name: 'Asignación de CVU de PSP',
    country: 'AR', kind: 'cvu_assignment', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa',
    officialUrl: 'https://www.coelsa.com.ar/',
    summary: 'Código de PSP real y CVU informable al directorio. El sandbox usa 0009999 y no está asignado por Coelsa.',
    wiringContract: 'Alta/baja de CVU y alias hacia el directorio nacional con el código de PSP homologado.',
    productIds: ['cvu'],
  },
  {
    id: 'coelsa_qr_pct', name: 'QR interoperable / PCT',
    country: 'AR', kind: 'qr_pct', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa',
    officialUrl: 'https://www.coelsa.com.ar/',
    summary: 'Pagos con transferencia vía QR leído por billeteras inscriptas. Exige certificación del administrador del esquema de transferencias inmediatas.',
    wiringContract: 'Instrucción PCT y certificados de interoperabilidad. El QR estático y la orden de venta Cimbra no sustituyen este riel.',
    productIds: ['qr_interoperable', 'collections'],
  },
  {
    id: 'card_bin_sponsor', name: 'BIN sponsor Visa o Mastercard',
    country: 'LATAM', kind: 'card_issuing', counterpartyKind: 'regulated_sponsor',
    counterparty: 'Entidad emisora o BIN sponsor regulado',
    officialUrl: 'https://www.pcisecuritystandards.org/',
    summary: 'Emisión real exige BIN de esquema o sponsor, no un last4 sintético. Pomelo documenta 403 sin PCI/AOC; Cimbra replica ese fail-closed.',
    wiringContract: 'Conectividad de esquema o sponsor, HSM y personalización. ISO 8583 queda en el perímetro de tarjetas.',
    productIds: ['card_issuing'],
  },
  {
    id: 'pci_dss_aoc', name: 'PCI DSS y AOC',
    country: 'LATAM', kind: 'card_issuing', counterpartyKind: 'official_registry',
    counterparty: 'PCI SSC / QSA',
    officialUrl: 'https://www.pcisecuritystandards.org/',
    summary: 'PAN/CVV y hostname PCI no existen hasta haber AOC vigente. El sandbox no genera datos de tarjeta.',
    wiringContract: 'Zona PCI, HSM y AOC. Sin eso no hay adaptador de PAN.',
    productIds: ['card_issuing'],
  },
  {
    id: 'official_biller_originators', name: 'Originadores oficiales de servicios',
    country: 'LATAM', kind: 'bill_payments', counterpartyKind: 'official_registry',
    counterparty: 'Originadores y redes de cobranza de cada país',
    officialUrl: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
    summary: 'Pago de servicios reales exige convenio directo con cada originador. El catálogo tenant no consulta un biller externo.',
    wiringContract: 'Consulta de deuda y confirmación autenticada por originador, fuera de la transacción del ledger.',
    productIds: ['bill_payments'],
  },
];

export const FINTECH_OFFICIAL_SOURCES = [
  {
    name: 'BCRA — Registro de PSP',
    url: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
    surface: 'Inscripción SEFyC, certificado RPSP, banco patrocinante para PSPCP y seis meses para iniciar operaciones.',
  },
  {
    name: 'BCRA — Billeteras digitales interoperables',
    url: 'https://www.bcra.gob.ar/inscripcion-registro-billeteras-digitales-interoperables/',
    surface: 'Registro adicional y certificados de interoperabilidad si Cimbra inicia pagos como billetera.',
  },
  {
    name: 'Coelsa',
    url: 'https://www.coelsa.com.ar/',
    surface: 'Cámara compensadora: directorio CBU/CVU/Alias, Transferencias 3.0, DEBIN, ECHEQ y QR/PCT.',
  },
] as const;

export const FINTECH_PATH_GATES = [
  { id: 'legal_entity_ar', connectionId: 'legal_entity_ar', name: 'Sociedad argentina', summary: 'Persona jurídica regularmente constituida en el país, con objeto compatible con servicios de pago.' },
  { id: 'bcra_psp_registry', connectionId: 'bcra_psp_registry', name: 'Inscripción PSP', summary: 'Certificado SEFyC y número RPSP. Sin eso Cimbra no es una fintech habilitada para dinero real.' },
  { id: 'sponsor_bank', connectionId: 'sponsor_bank', name: 'Banco patrocinante', summary: 'Contrato con entidad financiera patrocinante informado al BCRA para la figura PSPCP.' },
  { id: 'client_safeguarding', connectionId: 'client_safeguarding', name: 'Safeguarding', summary: 'Fondos de clientes individualizados y disponibles, cuenta operativa separada.' },
  { id: 'coelsa_directory', connectionId: 'coelsa_directory', name: 'Membresía Coelsa', summary: 'Integración con la cámara para directorio y, según el producto, T3.0, CVU, DEBIN, ECHEQ o PCT.' },
  { id: 'production_hostname', connectionId: null, name: 'Hostname de producción', summary: 'URL HTTPS de production provisionada. Sin ella no se emiten claves cim_sk_live_.' },
] as const;

type StatusErrorConstructor = new (message: string, status?: number, code?: string) => Error;

export type OfficialRailConnection = OfficialRailDefinition & {
  status: RailConnectionStatus;
  adapterRegistered: boolean;
  evidence: OfficialRailEvidence;
  dueDiligenceRequiredMet: boolean;
};

export type OfficialRailOverride = {
  id: string;
  status: RailConnectionStatus;
  evidence?: OfficialRailEvidence;
};

/**
 * Registro de adaptadores de riel de red/fondos. Vacío a propósito.
 * El banco patrocinante usa un adaptador documental calculado desde evidencia
 * (contrato + due diligence), nunca un conector hacia BaaS competidores.
 * Un adaptador de fondos no debe abrir una transacción SQL durante la llamada de red.
 */
export const OFFICIAL_RAIL_ADAPTERS: Partial<Record<string, { id: string }>> = {};

export function isRailConnectionStatus(value: string): value is RailConnectionStatus {
  return (RAIL_CONNECTION_STATUSES as readonly string[]).includes(value);
}

export function requiredRailIdsForProduct(productId: string) {
  return OFFICIAL_RAIL_CONNECTIONS.filter((rail) => rail.productIds.includes(productId)).map((rail) => rail.id);
}

function documentaryAdapterRegistered(railId: string, status: RailConnectionStatus, evidence: OfficialRailEvidence) {
  if (railId === 'sponsor_bank') return sponsorBankDocumentaryReady(evidence, status);
  return false;
}

export function materializeOfficialRails(
  overrides: ReadonlyArray<OfficialRailOverride | { id: string; status: RailConnectionStatus }> = [],
): OfficialRailConnection[] {
  const byId = new Map(overrides.map((row) => [row.id, row]));
  return OFFICIAL_RAIL_CONNECTIONS.map((rail) => {
    const override = byId.get(rail.id);
    const status = override?.status ?? 'unwired';
    const evidence = ('evidence' in (override ?? {}) && override && 'evidence' in override && override.evidence)
      ? override.evidence
      : emptyOfficialRailEvidence();
    const adapterRegistered = Boolean(OFFICIAL_RAIL_ADAPTERS[rail.id])
      || documentaryAdapterRegistered(rail.id, status, evidence);
    return {
      ...rail,
      status,
      evidence,
      dueDiligenceRequiredMet: rail.id === 'sponsor_bank'
        ? dueDiligenceProgress(evidence.dueDiligence).requiredMet
        : true,
      adapterRegistered,
    };
  });
}

export function missingLiveRailsForProduct(
  productId: string,
  rails: ReadonlyArray<{ id: string; status: RailConnectionStatus }>,
) {
  const byId = new Map(rails.map((rail) => [rail.id, rail.status]));
  return requiredRailIdsForProduct(productId).filter((id) => byId.get(id) !== 'live');
}

export function productOfficialAdaptersReady(productId: string) {
  return requiredRailIdsForProduct(productId).every((id) => Boolean(OFFICIAL_RAIL_ADAPTERS[id]));
}

export function productReadyForLiveMoney(
  productId: string,
  productStatus: string,
  rails: ReadonlyArray<{ id: string; status: RailConnectionStatus }>,
) {
  return productStatus === 'go_live'
    && missingLiveRailsForProduct(productId, rails).length === 0
    && productOfficialAdaptersReady(productId);
}

export function evaluateFintechPath(
  rails: ReadonlyArray<OfficialRailConnection>,
  productionHostnameProvisioned: boolean,
) {
  const byId = new Map(rails.map((rail) => [rail.id, rail]));
  const gates = FINTECH_PATH_GATES.map((gate) => {
    if (gate.connectionId === null) {
      return { ...gate, status: productionHostnameProvisioned ? 'live' as const : 'unwired' as const, met: productionHostnameProvisioned };
    }
    const connection = byId.get(gate.connectionId);
    const status = connection?.status ?? 'unwired';
    return { ...gate, status, met: status === 'live' };
  });
  return {
    jurisdiction: 'AR' as const,
    intendedFigure: 'PSPCP' as const,
    summary: 'Camino público de aprobación para operar como PSP que ofrece cuentas de pago en Argentina. No sustituye asesoramiento legal. Cimbra no está inscripta ni cableada a Coelsa.',
    officialSources: FINTECH_OFFICIAL_SOURCES,
    gates,
    metCount: gates.filter((gate) => gate.met).length,
    gateCount: gates.length,
  };
}

export function assertOfficialRailWired(
  connectionId: string,
  rails: ReadonlyArray<{ id: string; status: RailConnectionStatus }>,
  ErrorType: StatusErrorConstructor = PlatformRailError,
) {
  const rail = rails.find((item) => item.id === connectionId);
  if (rail?.status === 'live' && OFFICIAL_RAIL_ADAPTERS[connectionId]) return;
  if (rail?.status !== 'live') {
    throw new ErrorType('Este riel oficial no está cableado. Cimbra sólo conecta bancos, cámaras, esquemas o sponsors regulados.', 422, 'rail_not_wired');
  }
  throw new ErrorType('No hay adaptador registrado para este riel oficial. El ledger no despacha llamadas de red.', 422, 'rail_adapter_missing');
}

/** Punto de extensión: cuando exista homologación, el adaptador vive fuera del ledger. */
export function dispatchOfficialRail(
  connectionId: string,
  rails: ReadonlyArray<{ id: string; status: RailConnectionStatus }>,
  ErrorType: StatusErrorConstructor = PlatformRailError,
) {
  assertOfficialRailWired(connectionId, rails, ErrorType);
  throw new ErrorType('El adaptador está registrado pero aún no envía fondos. Completar la implementación contra la contraparte oficial.', 422, 'rail_adapter_not_implemented');
}
