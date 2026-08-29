ALTER TABLE "approval_policies" DROP CONSTRAINT "approval_policies_action";--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_action_resource";--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_action" CHECK ("approval_policies"."action_type" IN ('settlement.execute', 'transfer.create', 'risk.case.resolve', 'reconciliation.exception.resolve'));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_resource" CHECK ((
    ("approval_requests"."action_type" = 'settlement.execute' AND "approval_requests"."resource_type" = 'settlement_cycle') OR
    ("approval_requests"."action_type" = 'transfer.create' AND "approval_requests"."resource_type" = 'transfer') OR
    ("approval_requests"."action_type" = 'risk.case.resolve' AND "approval_requests"."resource_type" = 'risk_case') OR
    ("approval_requests"."action_type" = 'reconciliation.exception.resolve' AND "approval_requests"."resource_type" = 'reconciliation_exception')
  ));