ALTER TABLE "approval_policies" DROP CONSTRAINT "approval_policies_action";--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_action" CHECK ("action_type" IN ('settlement.execute', 'transfer.create', 'transfer.reverse', 'payment.create', 'payment.reverse', 'bill_payment.create', 'bill_payment.reverse', 'instant_transfer.create', 'instant_transfer.return', 'collection.refund', 'recurring_mandate.create', 'payout_batch.execute', 'risk.case.resolve', 'reconciliation.exception.resolve', 'dispute.resolve'));--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_action_resource";--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_resource" CHECK ((
  ("action_type" = 'settlement.execute' AND "resource_type" = 'settlement_cycle') OR
  ("action_type" = 'transfer.create' AND "resource_type" IN ('transfer', 'book_transfer')) OR
  ("action_type" = 'transfer.reverse' AND "resource_type" IN ('transfer', 'book_transfer')) OR
  ("action_type" = 'payment.create' AND "resource_type" = 'payment') OR
  ("action_type" = 'payment.reverse' AND "resource_type" = 'payment') OR
  ("action_type" = 'bill_payment.create' AND "resource_type" = 'bill_payment') OR
  ("action_type" = 'bill_payment.reverse' AND "resource_type" = 'bill_payment') OR
  ("action_type" = 'instant_transfer.create' AND "resource_type" = 'instant_transfer') OR
  ("action_type" = 'instant_transfer.return' AND "resource_type" = 'instant_transfer') OR
  ("action_type" = 'collection.refund' AND "resource_type" = 'payment_link') OR
  ("action_type" = 'recurring_mandate.create' AND "resource_type" = 'recurring_payment_mandate') OR
  ("action_type" = 'payout_batch.execute' AND "resource_type" = 'payout_batch') OR
  ("action_type" = 'risk.case.resolve' AND "resource_type" = 'risk_case') OR
  ("action_type" = 'reconciliation.exception.resolve' AND "resource_type" = 'reconciliation_exception') OR
  ("action_type" = 'dispute.resolve' AND "resource_type" = 'dispute')
));
