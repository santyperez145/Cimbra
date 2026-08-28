resource "aws_sns_topic" "critical" {
  name              = "${local.name}-critical"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.critical.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "Five or more target 5xx responses in consecutive minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.critical.arn]
  ok_actions          = [aws_sns_topic.critical.arn]
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix }
}

resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${local.name}-api-p95-latency"
  alarm_description   = "Target p95 exceeds 750 ms for five minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  threshold           = 0.75
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.critical.arn]
  ok_actions          = [aws_sns_topic.critical.arn]
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix }
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${local.name}-database-cpu"
  alarm_description   = "Database CPU exceeds 80% for ten minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 10
  datapoints_to_alarm = 10
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.critical.arn]
  ok_actions          = [aws_sns_topic.critical.arn]
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${local.name}-database-free-storage"
  alarm_description   = "Database has less than 20 GiB free"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 21474836480
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.critical.arn]
  ok_actions          = [aws_sns_topic.critical.arn]
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
}

resource "aws_cloudwatch_log_metric_filter" "dispatcher_errors" {
  name           = "${local.name}-dispatcher-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "?ERROR ?Error ?failed"

  metric_transformation {
    name      = "WebhookDispatcherErrors"
    namespace = "Cimbra/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "dispatcher_errors" {
  alarm_name          = "${local.name}-dispatcher-errors"
  alarm_description   = "Webhook recovery dispatcher emitted errors"
  namespace           = "Cimbra/${var.environment}"
  metric_name         = "WebhookDispatcherErrors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.critical.arn]
  ok_actions          = [aws_sns_topic.critical.arn]
}
