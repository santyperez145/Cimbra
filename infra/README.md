# Infraestructura de Cimbra

## Estado

La aplicación pública actual corre en Vercel con PostgreSQL administrado. `terraform/aws` define la plataforma objetivo para un piloto productivo en una cuenta AWS propia; es código ejecutable, pero no se aplica automáticamente porque crea recursos pagos y requiere un dominio, certificado y cuenta de destino.

## Topología del piloto

- ALB público con TLS y AWS WAF; las tareas Fargate no reciben tráfico directo.
- Dos o más instancias de la API en tres subredes privadas y despliegues con circuit breaker.
- PostgreSQL 16 Multi-AZ privado, cifrado con una CMK propia, backups de 35 días, PITR, Performance Insights y deletion protection.
- Outbox transaccional y leases en PostgreSQL como cola durable de webhooks. EventBridge inicia un dispatcher cada minuto; el proceso conserva entrega al menos una vez, backoff, DLQ lógica (`exhausted`) y replay.
- Secretos de aplicación y conexión en Secrets Manager, cifrados con KMS e inyectados sólo en runtime.
- Bucket privado, versionado y cifrado conectado mediante el adaptador S3 de evidencia de compliance. El despliegue Vercel conserva su adapter de Blob.
- Logs y alarmas en CloudWatch, flow logs de VPC y autoscaling por CPU y cantidad de requests.

Esta topología evita incorporar Kafka, Temporal, Redis o Kubernetes antes de tener carga que los justifique. Se agregan cuando aparecen workflows multi-servicio, partición del throughput, consumidores independientes o límites operativos que no pueda resolver el outbox de PostgreSQL.

## Aplicación controlada

1. Publicar una imagen inmutable del `Dockerfile` en ECR u otro registro privado.
2. Crear un backend S3 con locking para el estado de Terraform y configurar `backend.hcl` fuera del repositorio.
3. Copiar `terraform/aws/terraform.tfvars.example` a un archivo ignorado y completar imagen, certificado y URL pública.
4. Ejecutar `terraform init -backend-config=backend.hcl`, `terraform plan -out=plan.tfplan` y revisar costo, diff y políticas.
5. Aplicar primero en una cuenta de staging. Ejecutar la task definition indicada por el output `migration_task_definition_arn` en las subredes privadas y exigir exit code 0 antes de cambiar el tráfico. La imagen incluye `scripts/migrate.mjs` y el historial de migraciones.
6. Probar restore de backup, failover Multi-AZ, rollback de ECS, alarmas y entregas de webhook antes del piloto.

El estado remoto debe estar cifrado y con acceso restringido: contiene referencias sensibles y valores generados. No se debe commitear ningún `.tfvars`, plan ni estado.
