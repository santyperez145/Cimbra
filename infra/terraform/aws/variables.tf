variable "project_name" {
  description = "Lowercase name used to prefix every resource."
  type        = string
  default     = "cimbra"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.project_name))
    error_message = "project_name must be 3-21 lowercase alphanumeric or hyphen characters."
  }
}

variable "environment" {
  description = "Isolated deployment environment."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "aws_region" {
  description = "AWS region. sa-east-1 is the default for the initial South America deployment."
  type        = string
  default     = "sa-east-1"
}

variable "vpc_cidr" {
  description = "CIDR for the isolated Cimbra VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "container_image" {
  description = "Immutable API image reference. Use a digest, never latest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.container_image))
    error_message = "container_image must be pinned to a sha256 digest."
  }
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the public API hostname."
  type        = string
}

variable "public_url" {
  description = "Canonical HTTPS URL whose DNS record points to the ALB."
  type        = string

  validation {
    condition     = can(regex("^https://", var.public_url))
    error_message = "public_url must use HTTPS."
  }
}

variable "api_desired_count" {
  description = "Steady-state API task count across private subnets."
  type        = number
  default     = 2

  validation {
    condition     = var.api_desired_count >= 2
    error_message = "At least two API tasks are required."
  }
}

variable "api_cpu" {
  type    = number
  default = 1024
}

variable "api_memory" {
  type    = number
  default = 2048
}

variable "db_instance_class" {
  description = "Start small in staging; review observed load before production."
  type        = string
  default     = "db.t4g.medium"
}

variable "alert_email" {
  description = "Optional operations mailbox subscribed to critical alarms. Confirmation is required."
  type        = string
  default     = ""
}

variable "resend_api_key" {
  description = "Resend API key for transactional identity emails. Supply through an ignored tfvars file or TF_VAR_resend_api_key."
  type        = string
  sensitive   = true
  default     = ""
}

variable "cimbra_from_email" {
  description = "Verified transactional sender, including optional display name."
  type        = string
  default     = ""
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "apple_client_id" {
  type    = string
  default = ""
}

variable "apple_team_id" {
  type    = string
  default = ""
}

variable "apple_key_id" {
  type    = string
  default = ""
}

variable "apple_private_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "provider_secret_arns" {
  description = "Exact Secrets Manager ARNs that runtime provider adapters may resolve. Keep empty until a provider is contracted and homologated."
  type        = list(string)
  sensitive   = true
  default     = []
}
