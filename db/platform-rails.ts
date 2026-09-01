import { evaluateLiveReadiness, GO_LIVE_STAGES, type ProductStatus } from '@/app/lib/platform/live-readiness';
import { PlatformRailError } from '@/app/lib/platform/operating-mode';
import { getDatabase } from './runtime';

function isProductStatus(value: string): value is ProductStatus {
  return (GO_LIVE_STAGES as readonly string[]).includes(value);
}

export async function listProductStatusOverrides() {
  const rows = await getDatabase().prepare('SELECT id, status FROM platform_rails').all<{ id: string; status: string }>();
  return rows.results.filter((row): row is { id: string; status: ProductStatus } => isProductStatus(row.status));
}

export async function platformLiveReadiness() {
  return evaluateLiveReadiness(await listProductStatusOverrides());
}

type StatusErrorConstructor = new (message: string, status?: number, code?: string) => Error;

export async function assertSandboxLedgerOrCertifiedRail(productId: string, ErrorType: StatusErrorConstructor = PlatformRailError) {
  const readiness = await platformLiveReadiness();
  if (readiness.effectiveMode === 'sandbox') return;
  const product = readiness.products.find((item) => item.id === productId);
  if (product?.status === 'go_live') return;
  throw new ErrorType('Este producto no completó homologación ni Go Live.', 422, 'product_not_homologated');
}
