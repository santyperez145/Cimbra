import {
  CAPITAL_ALLOCATION_STATUSES, CAPITAL_PLAN, capitalPlanSnapshot, isForbiddenCapitalSpend,
  type CapitalAllocationStatus,
} from '@/app/lib/platform/capital-plan';
import { PlatformRailError } from '@/app/lib/platform/operating-mode';
import { getDatabase } from './runtime';

function isAllocationStatus(value: string): value is CapitalAllocationStatus {
  return (CAPITAL_ALLOCATION_STATUSES as readonly string[]).includes(value);
}

type CapitalAllocationId = (typeof CAPITAL_PLAN.allocations)[number]['id'];
const ALLOWED_IDS = new Set<string>(CAPITAL_PLAN.allocations.map((item) => item.id));

function isAllocationId(value: string): value is CapitalAllocationId {
  return ALLOWED_IDS.has(value);
}

export async function listCapitalAllocationOverrides() {
  const rows = await getDatabase().prepare(
    'SELECT id, status, note, updated_at AS "updatedAt" FROM capital_allocations',
  ).all<{ id: string; status: string; note: string; updatedAt: string }>();
  return rows.results.flatMap((row) => {
    if (!isAllocationId(row.id) || !isAllocationStatus(row.status)) return [];
    return [{ id: row.id, status: row.status, note: row.note, updatedAt: row.updatedAt }];
  });
}

export async function platformCapitalPlan() {
  return capitalPlanSnapshot(await listCapitalAllocationOverrides());
}

export async function updateCapitalAllocation(
  id: string,
  body: Record<string, unknown> | null,
) {
  if (!isAllocationId(id)) {
    throw new PlatformRailError('Asignación de capital desconocida.', 404, 'capital_allocation_not_found');
  }
  if (isForbiddenCapitalSpend(id)) {
    throw new PlatformRailError('Ese gasto está prohibido en el envelope Gate 1.', 422, 'capital_spend_forbidden');
  }
  const status = typeof body?.status === 'string' ? body.status.trim() : '';
  if (!isAllocationStatus(status)) {
    throw new PlatformRailError('Estado de asignación inválido.', 400, 'invalid_capital_status');
  }
  if (status === 'exhausted') {
    throw new PlatformRailError('Usá spent para registrar un gasto Gate 1; exhausted es derivado del envelope.', 400, 'invalid_capital_status');
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const now = new Date().toISOString();
  await getDatabase().prepare(
    `INSERT INTO capital_allocations (id, status, note, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
  ).bind(id, status, note, now).run();
  return {
    id,
    status,
    note,
    updatedAt: now,
    plan: await platformCapitalPlan(),
  };
}
