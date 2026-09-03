ALTER TABLE "approval_policies" DROP CONSTRAINT "approval_policies_action";--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_action" CHECK ("action_type" IN ('settlement.execute', 'transfer.create', 'payment.create', 'payout_batch.execute', 'risk.case.resolve', 'reconciliation.exception.resolve', 'dispute.resolve'));--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_action_resource";--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_resource" CHECK ((
  ("action_type" = 'settlement.execute' AND "resource_type" = 'settlement_cycle') OR
  ("action_type" = 'transfer.create' AND "resource_type" IN ('transfer', 'book_transfer')) OR
  ("action_type" = 'payment.create' AND "resource_type" = 'payment') OR
  ("action_type" = 'payout_batch.execute' AND "resource_type" = 'payout_batch') OR
  ("action_type" = 'risk.case.resolve' AND "resource_type" = 'risk_case') OR
  ("action_type" = 'reconciliation.exception.resolve' AND "resource_type" = 'reconciliation_exception') OR
  ("action_type" = 'dispute.resolve' AND "resource_type" = 'dispute')
));
