# Skill: DevOps & Deployment

## Overview

Sets up CI/CD pipelines, Docker containerization, Kubernetes deployment, and monitoring. The deployment is designed for horizontal scalability with health checks, graceful shutdown, and zero-downtime rollouts.

## Metadata

- **Name**: DevOps & Deployment
- **Description**: CI/CD, Docker, Kubernetes manifests, and observability stack
- **Complexity**: Medium
- **Estimated Time**: 3 hours
- **Dependencies**: Project Scaffolding, Testing Suite

## Inputs

```typescript
interface DevOpsDeploymentInputs {
  registry?: string;              // Default: 'ghcr.io/reaatech'
  imageTag?: string;              // Default: 'latest'
  replicas?: number;              // Default: 3
  enableHpa?: boolean;            // Default: true
  enableMonitoring?: boolean;     // Default: true
  databaseUrl?: string;           // From secrets
  redisUrl?: string;              // From secrets
}
```

## Outputs

### Docker Compose (Development)

```yaml
# docker-compose.yml
version: '3.8'
services:
  proxy:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://user:pass@db:5432/agent_auth
      - REDIS_URL=redis://redis:6379
      - MASTER_KEY=${MASTER_KEY}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    deploy:
      restart_policy:
        condition: on-failure

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=agent_auth
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d agent_auth"]
      interval: 5s
      timeout: 5s
      retries: 5
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  migrate:
    build: .
    command: ["pnpm", "db:migrate"]
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/agent_auth
    depends_on:
      db:
        condition: service_healthy
    profiles: ["setup"]

volumes:
  postgres_data:
  redis_data:
```

### Kubernetes Manifests

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-auth-proxy
  labels:
    app: agent-auth-proxy
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: agent-auth-proxy
  template:
    metadata:
      labels:
        app: agent-auth-proxy
    spec:
      terminationGracePeriodSeconds: 30
      containers:
      - name: proxy
        image: ghcr.io/reaatech/agent-auth-proxy:latest
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-secret
              key: url
        - name: MASTER_KEY
          valueFrom:
            secretKeyRef:
              name: encryption-secret
              key: master-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 10"]
```

### GitHub Actions (CI/CD)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: test_db
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run typecheck
      - run: pnpm run test:coverage
        env:
          DATABASE_URL: postgresql://test_user:test_pass@localhost:5432/test_db
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/reaatech/agent-auth-proxy:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Health Checks

```typescript
// src/api/routes/health.ts
import { FastifyPluginAsync } from 'fastify';
import { db } from '@/db';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/ready', async (request, reply) => {
    try {
      await db.execute('SELECT 1');
      return { status: 'ready', database: 'connected' };
    } catch (err) {
      reply.code(503);
      return { status: 'not_ready', database: 'disconnected' };
    }
  });

  fastify.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', 'text/plain');
    // Prometheus metrics output
    return '# TODO: Prometheus metrics\n';
  });
};
```

## Validation

After running this skill, verify:
- [ ] Docker build succeeds and container starts
- [ ] `docker-compose up` brings up all services
- [ ] Kubernetes manifests apply without errors
- [ ] Rolling update completes with zero downtime
- [ ] Health checks pass when DB is connected
- [ ] Readiness probe fails gracefully when DB is down
- [ ] CI pipeline runs tests, builds image, and pushes on main

## Security Considerations

- Secrets (DB URL, master key) must be Kubernetes secrets, never in Git
- Docker image runs as non-root user
- Network policies restrict pod-to-pod communication
- Container image scanning with Trivy or Snyk in CI

## Next Steps

After DevOps & deployment:
1. Terraform / Pulumi for infrastructure as code
2. Monitoring dashboards (Grafana + Prometheus)
3. Log aggregation (Loki or CloudWatch)
