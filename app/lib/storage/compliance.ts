import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { del, put } from '@vercel/blob';

let s3: S3Client | null = null;

function s3Client() {
  s3 ??= new S3Client({});
  return s3;
}

function s3Location(bucket: string, key: string) {
  return `s3://${bucket}/${key}`;
}

function parseS3Location(location: string) {
  if (!location.startsWith('s3://')) return null;
  const separator = location.indexOf('/', 5);
  if (separator < 0) return null;
  return { bucket: location.slice(5, separator), key: location.slice(separator + 1) };
}

export async function storeComplianceObject(key: string, file: File) {
  const bucket = process.env.CIMBRA_COMPLIANCE_BUCKET?.trim();
  if (bucket) {
    await s3Client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: file.type,
      Metadata: { dataClass: 'compliance-evidence' },
    }));
    return s3Location(bucket, key);
  }
  const blob = await put(key, file, {
    access: 'private',
    addRandomSuffix: false,
    contentType: file.type,
  });
  return blob.url;
}

export async function deleteComplianceObject(location: string) {
  const object = parseS3Location(location);
  if (object) {
    await s3Client().send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }));
    return;
  }
  await del(location);
}
