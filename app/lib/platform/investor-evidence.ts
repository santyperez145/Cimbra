import { PLATFORM_CAPABILITIES } from './capabilities.ts';
import { capitalPlanSnapshot } from './capital-plan.ts';
import { evaluateLiveReadiness, type LiveReadiness } from './live-readiness.ts';
import { serviceTopology } from './service-catalog.ts';

export function buildInvestorEvidence(
  readiness: LiveReadiness = evaluateLiveReadiness(),
  openApiOperations = 0,
) {
  const capital = readiness.capitalPlan ?? capitalPlanSnapshot();
  const services = serviceTopology();
  return {
    liveReady: readiness.liveReady,
    effectiveMode: readiness.effectiveMode,
    blockReason: readiness.blockReason,
    traction: {
      payingCustomers: 0,
      monthlyVolumeUsd: 0,
      lettersOfIntent: 0,
      note: 'Sin clientes, volumen ni LOIs inventados. El sandbox no mueve fondos reales.',
    },
    product: {
      openApiOperations,
      productsInIntegracion: readiness.summary.integracion,
      productsGoLive: readiness.summary.goLive,
      officialRailsLive: readiness.summary.officialRailsLive,
      officialRailsTotal: readiness.summary.officialRailsTotal,
      fintechGatesMet: readiness.fintechPath.metCount,
      fintechGatesTotal: readiness.fintechPath.gateCount,
      capabilities: {
        total: PLATFORM_CAPABILITIES.length,
        live: PLATFORM_CAPABILITIES.filter((item) => item.availability === 'live').length,
        sandbox: PLATFORM_CAPABILITIES.filter((item) => item.availability === 'sandbox').length,
        foundation: PLATFORM_CAPABILITIES.filter((item) => item.availability === 'foundation').length,
        roadmap: PLATFORM_CAPABILITIES.filter((item) => item.availability === 'roadmap').length,
      },
      services: {
        total: services.totals.services,
        extractable: services.totals.extractable,
        standalone: services.totals.standalone,
        extractionDebt: services.totals.extractionDebt,
      },
    },
    capital,
    fintechPath: readiness.fintechPath,
    environments: readiness.environments,
    products: readiness.products.map((product) => ({
      id: product.id,
      name: product.name,
      status: product.status,
      missingForProduction: product.missingForProduction,
    })),
  };
}

export type InvestorEvidence = ReturnType<typeof buildInvestorEvidence>;
