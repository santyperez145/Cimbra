output "load_balancer_dns_name" {
  description = "Create or update the public DNS record to this hostname."
  value       = aws_lb.api.dns_name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}

output "migration_task_definition_arn" {
  description = "Run this task in the private application subnets and require exit code 0 before updating the API service."
  value       = aws_ecs_task_definition.migration.arn
}

output "database_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "database_master_secret_arn" {
  value     = aws_db_instance.postgres.master_user_secret[0].secret_arn
  sensitive = true
}

output "application_secret_arn" {
  value     = aws_secretsmanager_secret.application.arn
  sensitive = true
}

output "compliance_bucket" {
  value = aws_s3_bucket.compliance.id
}

output "critical_alert_topic_arn" {
  value = aws_sns_topic.critical.arn
}
