import { NextResponse } from 'next/server';
import { del, put } from '@vercel/blob';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ensureDatabase, getDatabase, getOrCreateOrganization, recordAuditEvent } from '@/db/runtime';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024 || !allowedTypes.has(file.type)) {
    return NextResponse.json({ error: 'Adjuntá un PDF, JPG o PNG de hasta 5 MB.' }, { status: 400 });
  }
  await ensureDatabase();
  const organizationId = await getOrCreateOrganization(user);
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const objectKey = `compliance/${organizationId}/${id}-${safeName}`;
  const blob = await put(objectKey, file, {
    access: 'private',
    addRandomSuffix: false,
    contentType: file.type,
  });
  try {
    await getDatabase().prepare(
      `INSERT INTO compliance_documents
        (id, organization_id, object_key, file_name, content_type, size, status, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, organizationId, blob.url, safeName, file.type, file.size, 'received', user.userId, new Date().toISOString()).run();
  } catch (error) {
    await del(blob.url).catch(() => undefined);
    throw error;
  }
  await recordAuditEvent({ organizationId, actorId: user.userId, action: 'compliance.document_uploaded', resourceType: 'document', resourceId: id });
  return NextResponse.json({ ok: true, document: { id, fileName: safeName, status: 'received' } }, { status: 201 });
}
