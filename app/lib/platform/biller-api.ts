import { NextResponse } from 'next/server';
import { ApprovalError } from '@/db/approvals';
import { BillerError } from '@/db/billers';
import { LedgerError } from '@/db/ledger';
import { authorizationErrorResponse } from './authorization';
import { IdempotencyError } from './idempotency';

export function billerApiErrorResponse(error: unknown) {
  const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
  if (error instanceof IdempotencyError || error instanceof BillerError || error instanceof LedgerError || error instanceof ApprovalError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}

