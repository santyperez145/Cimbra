import type { AuthUser } from '@/app/lib/auth/types';
import {
  isClosedSupportStatus, type SupportCategory, type SupportStatus,
} from '@/app/lib/platform/support-input.ts';
import { getDatabaseClient, type DatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';

export class SupportError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'support_error') { super(message); }
}

type CaseRow = {
  id: string; organizationId: string; openedBy: string; openedByName: string; category: SupportCategory;
  subject: string; status: SupportStatus; createdAt: string; updatedAt: string; messageCount: number;
};

type MessageRow = {
  id: string; caseId: string; authorId: string; authorName: string; authorKind: 'tenant' | 'platform';
  body: string; createdAt: string;
};

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceId: string; payload?: Record<string, unknown>;
}) {
  const createdAt = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, 'support_case', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceId,
    JSON.stringify(input.payload ?? {}), createdAt).run();
  await enqueueWebhookEvent(database, {
    organizationId: input.organizationId, eventType: input.action, resourceType: 'support_case',
    resourceId: input.resourceId, data: input.payload,
  });
}

function serializeCase(row: CaseRow) {
  return row;
}

export async function listSupportCases(organizationId: string) {
  const rows = await getDatabaseClient().prepare(
    `SELECT c.id, c.organization_id AS "organizationId", c.opened_by AS "openedBy", u.display_name AS "openedByName",
      c.category, c.subject, c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      (SELECT COUNT(*)::int FROM support_messages m WHERE m.case_id = c.id) AS "messageCount"
     FROM support_cases c JOIN users u ON u.id = c.opened_by
     WHERE c.organization_id = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT 100`,
  ).bind(organizationId).all<CaseRow>();
  return rows.results.map(serializeCase);
}

export async function retrieveSupportCase(
  organizationId: string,
  id: string,
  database: DatabaseClient = getDatabaseClient(),
) {
  const row = await database.prepare(
    `SELECT c.id, c.organization_id AS "organizationId", c.opened_by AS "openedBy", u.display_name AS "openedByName",
      c.category, c.subject, c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      (SELECT COUNT(*)::int FROM support_messages m WHERE m.case_id = c.id) AS "messageCount"
     FROM support_cases c JOIN users u ON u.id = c.opened_by
     WHERE c.id = ? AND c.organization_id = ? LIMIT 1`,
  ).bind(id, organizationId).first<CaseRow>();
  if (!row) throw new SupportError('Caso de soporte no encontrado.', 404, 'support_case_not_found');
  const messages = await database.prepare(
    `SELECT m.id, m.case_id AS "caseId", m.author_id AS "authorId", u.display_name AS "authorName",
      m.author_kind AS "authorKind", m.body, m.created_at AS "createdAt"
     FROM support_messages m JOIN users u ON u.id = m.author_id
     WHERE m.case_id = ? ORDER BY m.created_at ASC, m.id ASC`,
  ).bind(id).all<MessageRow>();
  return { case: serializeCase(row), messages: messages.results };
}

export async function createSupportCase(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string | null;
  category: SupportCategory; subject: string; message: string;
}) {
  const now = new Date().toISOString();
  return getDatabaseClient().transaction(async (database) => {
    if (input.idempotencyKey) {
      await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
        .bind(`${input.organizationId}:support:${input.idempotencyKey}`).run();
      const existing = await database.prepare(
        `SELECT c.id FROM support_cases c WHERE c.organization_id = ? AND c.idempotency_key = ? LIMIT 1`,
      ).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
      if (existing) return { ...(await retrieveSupportCase(input.organizationId, existing.id, database)), replayed: true };
    }
    const open = await database.prepare(
      `SELECT COUNT(*)::int AS count FROM support_cases WHERE organization_id = ? AND status IN ('open', 'pending_cimbra', 'pending_tenant')`,
    ).bind(input.organizationId).first<{ count: number }>();
    if ((open?.count ?? 0) >= 20) throw new SupportError('Hay 20 casos abiertos. Cerrá uno antes de abrir otro.', 409, 'support_case_limit');
    const id = crypto.randomUUID();
    await database.prepare(
      `INSERT INTO support_cases (id, organization_id, idempotency_key, opened_by, category, subject, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).bind(id, input.organizationId, input.idempotencyKey, input.actor.userId, input.category, input.subject, now, now).run();
    await database.prepare(
      `INSERT INTO support_messages (id, case_id, organization_id, idempotency_key, author_id, author_kind, body, created_at)
       VALUES (?, ?, ?, ?, ?, 'tenant', ?, ?)`,
    ).bind(crypto.randomUUID(), id, input.organizationId, input.idempotencyKey ? `${input.idempotencyKey}:open` : null,
      input.actor.userId, input.message, now).run();
    await audit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'support.case_opened',
      resourceId: id, payload: { category: input.category },
    });
    return { ...(await retrieveSupportCase(input.organizationId, id, database)), replayed: false };
  });
}

export async function addSupportMessage(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string | null; id: string;
  body: string; authorKind: 'tenant' | 'platform';
}) {
  const now = new Date().toISOString();
  return getDatabaseClient().transaction(async (database) => {
    if (input.idempotencyKey) {
      await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
        .bind(`${input.organizationId}:support-msg:${input.idempotencyKey}`).run();
      const existing = await database.prepare(
        `SELECT case_id AS "caseId" FROM support_messages WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
      ).bind(input.organizationId, input.idempotencyKey).first<{ caseId: string }>();
      if (existing) return { ...(await retrieveSupportCase(input.organizationId, existing.caseId, database)), replayed: true };
    }
    const current = await database.prepare(
      `SELECT id, status FROM support_cases WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
    ).bind(input.id, input.organizationId).first<{ id: string; status: SupportStatus }>();
    if (!current) throw new SupportError('Caso de soporte no encontrado.', 404, 'support_case_not_found');
    if (isClosedSupportStatus(current.status)) throw new SupportError('El caso está cerrado.', 409, 'support_case_closed');
    const count = await database.prepare(
      'SELECT COUNT(*)::int AS count FROM support_messages WHERE case_id = ?',
    ).bind(input.id).first<{ count: number }>();
    if ((count?.count ?? 0) >= 40) throw new SupportError('El caso alcanzó el máximo de mensajes.', 409, 'support_message_limit');
    const nextStatus: SupportStatus = input.authorKind === 'platform' ? 'pending_tenant' : 'pending_cimbra';
    await database.prepare(
      `INSERT INTO support_messages (id, case_id, organization_id, idempotency_key, author_id, author_kind, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.id, input.organizationId, input.idempotencyKey, input.actor.userId, input.authorKind, input.body, now).run();
    await database.prepare('UPDATE support_cases SET status = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, now, input.id).run();
    await audit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'support.message_added',
      resourceId: input.id, payload: { authorKind: input.authorKind },
    });
    return { ...(await retrieveSupportCase(input.organizationId, input.id, database)), replayed: false };
  });
}

export async function updateSupportStatus(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string | null; id: string; status: SupportStatus;
}) {
  const now = new Date().toISOString();
  return getDatabaseClient().transaction(async (database) => {
    const current = await database.prepare(
      `SELECT id, status FROM support_cases WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
    ).bind(input.id, input.organizationId).first<{ id: string; status: SupportStatus }>();
    if (!current) throw new SupportError('Caso de soporte no encontrado.', 404, 'support_case_not_found');
    if (current.status === input.status) return { ...(await retrieveSupportCase(input.organizationId, input.id, database)), replayed: true };
    await database.prepare('UPDATE support_cases SET status = ?, updated_at = ? WHERE id = ?')
      .bind(input.status, now, input.id).run();
    await audit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'support.status_updated',
      resourceId: input.id, payload: { from: current.status, to: input.status },
    });
    return { ...(await retrieveSupportCase(input.organizationId, input.id, database)), replayed: false };
  });
}

export async function platformSupportCaseOrganization(id: string) {
  const row = await getDatabaseClient().prepare(
    'SELECT organization_id AS "organizationId" FROM support_cases WHERE id = ? LIMIT 1',
  ).bind(id).first<{ organizationId: string }>();
  if (!row) throw new SupportError('Caso de soporte no encontrado.', 404, 'support_case_not_found');
  return row.organizationId;
}

export async function listPlatformSupportCases() {
  const rows = await getDatabaseClient().prepare(
    `SELECT c.id, c.organization_id AS "organizationId", o.name AS "organizationName", c.opened_by AS "openedBy",
      u.display_name AS "openedByName", c.category, c.subject, c.status, c.created_at AS "createdAt",
      c.updated_at AS "updatedAt",
      (SELECT COUNT(*)::int FROM support_messages m WHERE m.case_id = c.id) AS "messageCount"
     FROM support_cases c
     JOIN organizations o ON o.id = c.organization_id
     JOIN users u ON u.id = c.opened_by
     ORDER BY c.updated_at DESC, c.id DESC LIMIT 200`,
  ).all<CaseRow & { organizationName: string }>();
  return rows.results;
}
