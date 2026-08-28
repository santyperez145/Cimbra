import { POST as uploadDocument } from '../../../compliance/documents/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request) { return versionedApi(request, () => uploadDocument(request)); }
