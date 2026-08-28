import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { deleteComplianceObject, storeComplianceObject } from '@/app/lib/storage/compliance';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

async function hasExpectedSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (file.type === 'application/pdf') return [0x25, 0x50, 0x44, 0x46, 0x2d].every((value, index) => bytes[index] === value);
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return false;
}

export async function POST(request: Request) {
  let principal;
  try {
    principal = await authorizeApiRequest(request, { scope: 'compliance:write', roles: ['owner', 'admin', 'operator'], mutation: true });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const { user, organizationId } = principal;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024 || !allowedTypes.has(file.type) || !(await hasExpectedSignature(file))) {
    return NextResponse.json({ error: 'Adjuntá un PDF, JPG o PNG de hasta 5 MB.' }, { status: 400 });
  }
  try {
    await ensureDatabase();
  } catch (error) {
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const id = crypto.randomUUID();
  const fallbackName = file.type === 'application/pdf' ? 'evidence.pdf' : file.type === 'image/png' ? 'evidence.png' : 'evidence.jpg';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || fallbackName;
  const objectKey = `compliance/${organizationId}/${id}-${safeName}`;
  const storedObject = await storeComplianceObject(objectKey, file);
  try {
    await getDatabase().transaction(async (transaction) => {
      await transaction.prepare(
        `INSERT INTO compliance_documents
          (id, organization_id, object_key, file_name, content_type, size, status, uploaded_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, organizationId, storedObject, safeName, file.type, file.size, 'received', user.userId, new Date().toISOString()).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'compliance.document_uploaded', resourceType: 'document', resourceId: id }, transaction);
    });
  } catch (error) {
    await deleteComplianceObject(storedObject).catch(() => undefined);
    throw error;
  }
  scheduleWebhookDispatch(organizationId);
  return NextResponse.json({ ok: true, document: { id, fileName: safeName, status: 'received' } }, {
    status: 201, headers: rateLimitHeaders(principal),
  });
}
