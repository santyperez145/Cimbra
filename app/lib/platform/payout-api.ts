import { NextResponse } from 'next/server';
import { PayoutError } from '@/db/payouts';
import { LedgerError } from '@/db/ledger';
import { authorizationErrorResponse } from './authorization';
import { IdempotencyError } from './idempotency';

export function payoutApiErrorResponse(error: unknown) {
  const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
  if (error instanceof IdempotencyError || error instanceof PayoutError || error instanceof LedgerError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}
