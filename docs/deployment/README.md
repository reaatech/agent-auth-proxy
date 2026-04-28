# Deployment Documentation

## Docker Compose

See [docker-compose.yml](../../docker-compose.yml) for local development.

```bash
docker compose up -d
docker compose --profile setup run --rm migrate
```

## Kubernetes

See `k8s/` directory for manifests:
- `deployment.yaml` - Main application deployment
- `service.yaml` - Service exposure
- `ingress.yaml` - Ingress rules
- `secrets.yaml` - Secret templates (do not commit real values)
- `hpa.yaml` - Horizontal pod autoscaling

## Environment Setup

1. Generate a 32-byte base64 master key:
   ```bash
   openssl rand -base64 32
   ```
2. Generate a random encryption salt (16+ chars)
3. Generate agent JWT secret (32-byte base64 or strong random string)
4. Generate admin API key (strong random string)
5. Configure OAuth credentials in Google Cloud Console and GitHub Developer Settings
