import {
  OPERATING_MODES, PlatformRailError, effectiveOperatingMode, requestedOperatingMode, type OperatingMode,
} from './operating-mode.ts';
import {
  evaluateFintechPath, materializeOfficialRails, missingLiveRailsForProduct, productOfficialAdaptersReady,
  productReadyForLiveMoney, requiredRailIdsForProduct, type RailConnectionStatus,
} from './official-rails.ts';

/** Pomelo: Integración → Homologación → Go Live. https://docs.pomelo.la/docs/get-started/home */
export const GO_LIVE_STAGES = ['integracion', 'homologacion', 'go_live'] as const;
export type GoLiveStage = typeof GO_LIVE_STAGES[number];
export type ProductStatus = GoLiveStage;

/** Documentación pública de los benchmarks. No son conectores ni dependencias. */
export const COMPETITOR_REFERENCES = [
  { benchmark: 'BIND APIBANK', url: 'https://apibank.bind.com.ar/', surface: 'Cuentas, consulta Alias/CBU/CVU, transferencias, DEBIN, ECHEQ y altas de CVU.' },
  { benchmark: 'BIND PSP Cobro', url: 'https://psp.bind.com.ar/developers/cobro', surface: 'Deuda, QR, transferencia/CVU y cuenta recaudadora.' },
  { benchmark: 'BIND PSP Pagar QR', url: 'https://psp.bind.com.ar/developers/apis/pagar-qr', surface: 'PCT en Coelsa, QR estático de caja y QR de deuda.' },
  { benchmark: 'BIND ECHEQ', url: 'https://blog.bind.com.ar/api-echeq-para-empresas/', surface: 'Emisión, endoso, depósito, cesión, descuento, anulación, ARS y USD.' },
  { benchmark: 'Pismo environments', url: 'https://developers.pismo.io/pismo-docs/docs/environments', surface: 'sandbox.pismolabs.io vs hostname de producción; PCI en gw-pci.pismolabs.io.' },
  { benchmark: 'Pomelo get started', url: 'https://docs.pomelo.la/docs/get-started/home', surface: 'Integración, Homologación y Go Live. sandbox.api.pomelo.la vs api.pomelo.la.' },
  { benchmark: 'Pomelo Issuing', url: 'https://developers.pomelo.la/api-reference/cards/issuing', surface: 'PAN/CVV exigen PCI DSS y AOC; BIN Visa o Mastercard.' },
  { benchmark: 'tapi', url: 'https://tapi.la/', surface: 'companies, debts, payment, confirm, recargas y gift cards.' },
] as const;

export type PlatformProduct = {
  id: string;
  name: string;
  country: 'AR' | 'LATAM';
  benchmark: string;
  documentationUrl: string;
  network: string;
  sandboxCoverage: string;
  missingForProduction: string;
  status: ProductStatus;
  requiredRailIds: string[];
  missingOfficialRails: string[];
  adapterReady: boolean;
};

type StatusErrorConstructor = new (message: string, status?: number, code?: string) => Error;

export const PLATFORM_PRODUCTS: readonly Omit<PlatformProduct, 'status' | 'requiredRailIds' | 'missingOfficialRails' | 'adapterReady'>[] = [
  {
    id: 'account_lookup', name: 'Consulta de titular CBU, CVU y Alias', country: 'AR',
    benchmark: 'BIND APIBANK — Datos de una cuenta por Alias, CBU, CVU',
    documentationUrl: 'https://apibank.bind.com.ar/',
    network: 'Directorio interbancario / Coelsa',
    sandboxCoverage: 'Preview del titular sólo dentro del tenant. No consulta el directorio nacional.',
    missingForProduction: 'Consulta de CBU/CVU/Alias homologada con la red, no un catálogo interno.',
  },
  {
    id: 'transfers', name: 'Transferencias a CBU, CVU y Alias', country: 'AR',
    benchmark: 'BIND APIBANK — Transferencias',
    documentationUrl: 'https://apibank.bind.com.ar/',
    network: 'Transferencias 3.0',
    sandboxCoverage: 'Crédito entre cuentas Cimbra o cash-out a settlement interno. 7x24 de ledger, no de cámara.',
    missingForProduction: 'Transferencia inmediata contra CBU/CVU/Alias reales, irreversible al completar.',
  },
  {
    id: 'debin', name: 'DEBIN', country: 'AR',
    benchmark: 'BIND APIBANK — Recaudación DEBIN; BIND PSP — Debin recurrente / fondeo',
    documentationUrl: 'https://apibank.bind.com.ar/',
    network: 'DEBIN / Coelsa',
    sandboxCoverage: 'Solicitud de débito sólo entre cuentas del mismo tenant. El pagador responde en Cimbra.',
    missingForProduction: 'DEBIN contra CBU/CVU externo, adhesión del vendedor y vencimiento en el banco del pagador.',
  },
  {
    id: 'echeq', name: 'ECHEQ', country: 'AR',
    benchmark: 'BIND — API ECHEQ (emisión, endoso, depósito, cesión, descuento, anulación, ARS y USD)',
    documentationUrl: 'https://blog.bind.com.ar/api-echeq-para-empresas/',
    network: 'ECHEQ / Coelsa',
    sandboxCoverage: 'Emisión, aceptación, endoso, depósito interno, anulación y devolución previa. CUIT AFIP.',
    missingForProduction: 'ID Coelsa, cesión, descuento, USD, depósito en cuenta corriente y compensación de cámara.',
  },
  {
    id: 'cvu', name: 'Alta de CVU y alias', country: 'AR',
    benchmark: 'BIND APIBANK — Billeteras virtuales: altas de CVU y cambio de alias',
    documentationUrl: 'https://apibank.bind.com.ar/',
    network: 'CVU asignado por PSP / Coelsa',
    sandboxCoverage: 'CVU sintético 000 + PSP 9999, no asignado por Coelsa.',
    missingForProduction: 'Código de PSP real y CVU informable al directorio nacional.',
  },
  {
    id: 'qr_interoperable', name: 'QR interoperable', country: 'AR',
    benchmark: 'BIND PSP — Pagar QR (PCT en Coelsa), QR estático de caja y QR de deuda',
    documentationUrl: 'https://psp.bind.com.ar/developers/apis/pagar-qr',
    network: 'QR interoperable / Coelsa',
    sandboxCoverage: 'QR dinámico cimbra:qr:v1, QR estático cimbra:qr:static:v1, orden de venta Cimbra y QR de deuda cimbra:qr:debt:v1. Cobro cerrado en el tenant. No es PCT ni lectura por otras billeteras.',
    missingForProduction: 'Instrucción PCT Coelsa, certificación del administrador del esquema de transferencias inmediatas y registro de billetera interoperable si Cimbra inicia pagos. El QR estático, la orden de venta y el QR de deuda Cimbra no sustituyen el riel.',
  },
  {
    id: 'collections', name: 'Cobro (deuda, link y recaudación)', country: 'AR',
    benchmark: 'BIND PSP Cobro — deuda, QR, transferencia/CVU y cuenta recaudadora',
    documentationUrl: 'https://psp.bind.com.ar/developers/cobro',
    network: 'Transferencias 3.0 / DEBIN / QR interoperable',
    sandboxCoverage: 'Links cimbra:link:v1, eco cerrado e inbound de ledger. Tarjeta, POS y QR de red responden 422.',
    missingForProduction: 'Botón de pago, caja, POS y liquidación a cuenta recaudadora homologada.',
  },
  {
    id: 'card_issuing', name: 'Issuing de tarjetas', country: 'LATAM',
    benchmark: 'Pomelo Issuing — PAN/CVV exigen PCI DSS y AOC; BIN Visa o Mastercard',
    documentationUrl: 'https://developers.pomelo.la/api-reference/cards/issuing',
    network: 'Visa / Mastercard vía BIN sponsor',
    sandboxCoverage: 'Programas, lifecycle y controles. last4 sintético. Sin PAN, CVV ni red.',
    missingForProduction: 'Homologación, PCI DSS + AOC y BIN sponsor. Sin eso Pomelo responde 403 al pedir datos de tarjeta.',
  },
  {
    id: 'bill_payments', name: 'Pago de servicios, recargas y pines', country: 'LATAM',
    benchmark: 'tapi — companies, debts, payment, confirm, recargas y gift cards',
    documentationUrl: 'https://tapi.la/',
    network: 'Originadores y redes de cobranza de cada país',
    sandboxCoverage: 'Catálogo tenant, deuda emitida y pago ledger-backed. Sin consulta a un biller externo.',
    missingForProduction: 'Cobertura comercial, consulta de deuda real y confirmación con cada originador.',
  },
];

export const GO_LIVE_PROCESS = {
  benchmark: 'Pomelo',
  documentationUrl: 'https://docs.pomelo.la/docs/get-started/home',
  stages: [
    { id: 'integracion', name: 'Integración', summary: 'Presentar documentación y conectar los servicios.' },
    { id: 'homologacion', name: 'Homologación', summary: 'Probar la integración y certificar calidad y seguridad.' },
    { id: 'go_live', name: 'Go Live', summary: 'Lanzar de forma gradual y monitorear.' },
  ],
  current: 'integracion' as GoLiveStage,
} as const;

function productionHostname() {
  const value = process.env.CIMBRA_PRODUCTION_HOSTNAME?.trim() ?? '';
  return /^https:\/\//i.test(value) ? value.replace(/\/$/, '') : null;
}

function sandboxHostname() {
  const value = process.env.CIMBRA_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_CIMBRA_PUBLIC_URL?.trim() || '';
  return /^https:\/\//i.test(value) ? value.replace(/\/$/, '') : 'https://cimbra-rose.vercel.app';
}

export function platformEnvironments() {
  const production = productionHostname();
  return [
    {
      id: 'sandbox' as const,
      status: 'active' as const,
      hostname: sandboxHostname(),
      pciHostname: null,
      credentialsPrefix: 'cim_sk_test_',
      benchmark: 'sandbox.bind.com.ar, sandbox.pismolabs.io, sandbox.api.pomelo.la',
    },
    {
      id: 'production' as const,
      status: production ? 'provisioned' as const : 'not_provisioned' as const,
      hostname: production,
      pciHostname: null,
      credentialsPrefix: 'cim_sk_live_',
      benchmark: 'Pismo entrega hostnames de producción en el onboarding; BIND no publica la URL productiva; Pomelo usa api.pomelo.la después de homologar. Pismo separa además un hostname PCI (gw-pci.pismolabs.io en test).',
    },
  ];
}

export function materializeProducts(
  overrides: ReadonlyArray<{ id: string; status: ProductStatus }> = [],
  rails: ReadonlyArray<{ id: string; status: RailConnectionStatus }> = [],
): PlatformProduct[] {
  const byId = new Map(overrides.map((row) => [row.id, row]));
  return PLATFORM_PRODUCTS.map((product) => {
    const status = byId.get(product.id)?.status ?? 'integracion';
    const requiredRailIds = requiredRailIdsForProduct(product.id);
    return {
      ...product,
      status,
      requiredRailIds,
      missingOfficialRails: missingLiveRailsForProduct(product.id, rails),
      adapterReady: productOfficialAdaptersReady(product.id),
    };
  });
}

function liveBlockReason(input: {
  liveReady: boolean;
  hostnameProvisioned: boolean;
  products: PlatformProduct[];
}) {
  if (input.liveReady) return null;
  if (!input.hostnameProvisioned) return 'production_hostname_not_provisioned';
  const goLiveProducts = input.products.filter((product) => product.status === 'go_live');
  if (goLiveProducts.length === 0) return 'homologacion_pendiente';
  if (goLiveProducts.some((product) => product.missingOfficialRails.length > 0)) return 'official_rails_not_live';
  return 'official_rail_adapter_missing';
}

export function evaluateLiveReadiness(
  overrides: ReadonlyArray<{ id: string; status: ProductStatus }> = [],
  railOverrides: ReadonlyArray<{ id: string; status: RailConnectionStatus }> = [],
) {
  const environments = platformEnvironments();
  const rails = materializeOfficialRails(railOverrides);
  const products = materializeProducts(overrides, rails);
  const production = environments.find((item) => item.id === 'production');
  const hostnameProvisioned = production?.status === 'provisioned';
  const liveReady = Boolean(hostnameProvisioned) && products.some((product) => (
    productReadyForLiveMoney(product.id, product.status, rails)
  ));
  const requestedMode = requestedOperatingMode();
  const effectiveMode = effectiveOperatingMode(liveReady);
  return {
    requestedMode,
    effectiveMode,
    liveReady,
    liveBlocked: requestedMode === 'live' && !liveReady,
    blockReason: liveBlockReason({ liveReady, hostnameProvisioned: Boolean(hostnameProvisioned), products }),
    modes: OPERATING_MODES,
    goLive: GO_LIVE_PROCESS,
    environments,
    products,
    rails,
    fintechPath: evaluateFintechPath(rails, Boolean(hostnameProvisioned)),
    references: COMPETITOR_REFERENCES,
    summary: {
      integracion: products.filter((product) => product.status === 'integracion').length,
      homologacion: products.filter((product) => product.status === 'homologacion').length,
      goLive: products.filter((product) => product.status === 'go_live').length,
      officialRailsLive: rails.filter((rail) => rail.status === 'live').length,
      officialRailsTotal: rails.length,
    },
  };
}

export type LiveReadiness = ReturnType<typeof evaluateLiveReadiness>;

export function currentOperatingMode(overrides?: Parameters<typeof evaluateLiveReadiness>[0]): OperatingMode {
  return evaluateLiveReadiness(overrides).effectiveMode;
}

export function requireSandboxLedgerOrCertifiedRail(productId: string, ErrorType: StatusErrorConstructor = PlatformRailError) {
  const readiness = evaluateLiveReadiness();
  if (readiness.effectiveMode === 'sandbox') return;
  const product = readiness.products.find((item) => item.id === productId);
  if (product?.status !== 'go_live') {
    throw new ErrorType('Este producto no completó homologación ni go-live.', 422, 'product_not_homologated');
  }
  if (product.missingOfficialRails.length > 0) {
    throw new ErrorType('Este producto no tiene cableados los rieles oficiales (banco, cámara, esquema o sponsor).', 422, 'rail_not_wired');
  }
  if (!product.adapterReady) {
    throw new ErrorType('No hay adaptador registrado para los rieles oficiales de este producto.', 422, 'rail_adapter_missing');
  }
}

export function requireLiveApiKeysEnabled() {
  if (!evaluateLiveReadiness().liveReady) {
    throw new PlatformRailError('Live sigue fail-closed: falta hostname de producción, homologación, rieles oficiales en live o adaptador de cámara/banco/esquema.', 403, 'live_environment_disabled');
  }
}
