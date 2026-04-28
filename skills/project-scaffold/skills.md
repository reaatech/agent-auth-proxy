# Skill: Project Scaffolding

## Overview

Initializes the agent-auth-proxy project structure with all necessary configuration files, dependencies, and directory organization following enterprise TypeScript best practices.

## Metadata

- **Name**: Project Scaffolding
- **Description**: Sets up the complete project structure with TypeScript, Fastify, pnpm, and all development tooling
- **Complexity**: Low
- **Estimated Time**: 30 minutes
- **Dependencies**: None

## Inputs

```typescript
interface ProjectScaffoldInputs {
  projectName: string;        // Default: 'agent-auth-proxy'
  githubUser: string;         // Default: 'reaatech'
  description: string;        // Project description
  version: string;           // Default: '1.0.0'
  license: string;           // Default: 'MIT'
  nodeVersion: string;       // Default: '20'
  includeDocker: boolean;    // Default: true
  includeKubernetes: boolean; // Default: true
}
```

## Outputs

### Directory Structure
```
agent-auth-proxy/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── proxy.ts
│   │   │   ├── management.ts
│   │   │   └── health.ts
│   │   └── middleware/
│   │       ├── auth.ts
│   │       ├── rateLimit.ts
│   │       ├── validation.ts
│   │       └── audit.ts
│   ├── auth/
│   │   ├── strategies/
│   │   │   ├── oauth2.ts
│   │   │   ├── apiKey.ts
│   │   │   └── serviceAccount.ts
│   │   ├── managers/
│   │   │   ├── tokenManager.ts
│   │   │   ├── keyVault.ts
│   │   │   └── scopeManager.ts
│   │   └── services/
│   │       ├── encryptionService.ts
│   │       └── validationService.ts
│   ├── config/
│   │   ├── index.ts
│   │   ├── database.ts
│   │   ├── auth.ts
│   │   └── security.ts
│   ├── db/
│   │   ├── schema/
│   │   │   ├── users.ts
│   │   │   ├── agents.ts
│   │   │   ├── tokens.ts
│   │   │   ├── grants.ts
│   │   │   └── audit.ts
│   │   ├── migrations/
│   │   └── seeders/
│   ├── services/
│   │   ├── proxyService.ts
│   │   ├── tokenService.ts
│   │   ├── auditService.ts
│   │   └── monitoringService.ts
│   ├── types/
│   │   ├── auth.ts
│   │   ├── proxy.ts
│   │   ├── database.ts
│   │   └── config.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── errors.ts
│   │   ├── helpers.ts
│   │   └── constants.ts
│   ├── proxy/
│   │   ├── engine.ts
│   │   ├── transformers.ts
│   │   └── handlers.ts
│   └── app.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── performance/
├── docs/
│   ├── api/
│   ├── architecture/
│   └── deployment/
├── scripts/
│   ├── setup.ts
│   ├── migrate.ts
│   └── seed.ts
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── cd.yml
│       └── security.yml
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose.prod.yml
├── k8s/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   └── secrets.yaml
├── .env.example
├── .envrc
├── .gitignore
├── .eslintrc.js
├── .prettierrc
├── .editorconfig
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── pnpm-workspace.yaml
├── Dockerfile
├── docker-compose.yml
├── README.md
├── LICENSE
├── AGENTS.md
├── DEV_PLAN.md
└── ARCHITECTURE.md
```

### Configuration Files

#### package.json
```json
{
  "name": "agent-auth-proxy",
  "version": "1.0.0",
  "description": "Identity-aware proxy for agent-to-service communication",
  "main": "dist/app.js",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsup src/app.ts --format esm --dts",
    "start": "node dist/app.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:security": "vitest run tests/security",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write src/**/*.ts",
    "format:check": "prettier --check src/**/*.ts",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:seed": "tsx scripts/seed.ts",
    "db:studio": "drizzle-kit studio",
    "docker:build": "docker build -t agent-auth-proxy .",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "prepare": "husky || true"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "@fastify/helmet": "^11.1.1",
    "@fastify/jwt": "^8.0.0",
    "@fastify/rate-limit": "^9.1.0",
    "@fastify/swagger": "^8.14.0",
    "@fastify/type-provider-typebox": "^4.0.0",
    "drizzle-orm": "^0.29.0",
    "fastify": "^4.25.0",
    "pino": "^8.17.0",
    "pino-pretty": "^10.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "@vitest/coverage-v8": "^1.0.0",
    "drizzle-kit": "^0.20.0",
    "eslint": "^8.55.0",
    "eslint-config-prettier": "^9.1.0",
    "husky": "^8.0.3",
    "lint-staged": "^15.2.0",
    "prettier": "^3.1.0",
    "supertest": "^6.3.3",
    "tsup": "^8.0.1",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "keywords": [
    "proxy",
    "auth",
    "oauth2",
    "api",
    "agent",
    "identity",
    "security"
  ],
  "author": "reaatech",
  "license": "MIT"
}
```

#### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@auth/*": ["src/auth/*"],
      "@config/*": ["src/config/*"],
      "@db/*": ["src/db/*"],
      "@services/*": ["src/services/*"],
      "@types/*": ["src/types/*"],
      "@utils/*": ["src/utils/*"],
      "@proxy/*": ["src/proxy/*"]
    },
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

#### Dockerfile
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:20-alpine AS runtime

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/app.js"]
```

#### .dockerignore
```
node_modules
.git
.env
.env.local
dist
coverage
.vscode
.idea
*.log
npm-debug.log*
```

#### .github/workflows/ci.yml
```yaml
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
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9
          
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        
      - name: Run linter
        run: pnpm run lint
        
      - name: Run type checker
        run: pnpm run typecheck
        
      - name: Run tests
        run: pnpm run test:coverage
        env:
          DATABASE_URL: postgresql://test_user:test_pass@localhost:5432/test_db
          
      - name: Run security tests
        run: pnpm run test:security
```

## Implementation Steps

1. **Initialize pnpm workspace**
   ```bash
   pnpm init
   pnpm workspace init
   ```

2. **Create directory structure**
   ```bash
   mkdir -p src/{api,auth,config,db,services,types,utils,proxy}
   mkdir -p tests/{unit,integration,security,performance}
   mkdir -p docs/{api,architecture,deployment}
   mkdir -p scripts
   mkdir -p .github/workflows
   mkdir -p docker
   mkdir -p k8s
   ```

3. **Install dependencies**
   ```bash
   pnpm add fastify @fastify/* drizzle-orm pino zod
   pnpm add -D typescript tsup vitest @types/node supertest
   pnpm add -D eslint prettier @typescript-eslint/*
   pnpm add -D drizzle-kit husky lint-staged
   ```

4. **Configure TypeScript**
   - Create tsconfig.json with strict mode
   - Set up path aliases for clean imports

5. **Set up development tools**
   - Configure ESLint with TypeScript support
   - Configure Prettier for code formatting
   - Set up Husky for pre-commit hooks
   - Configure lint-staged for staged file linting

6. **Create base application structure**
   - Set up Fastify server with plugins
   - Configure environment variables
   - Set up logging with Pino
   - Create health check endpoints

7. **Configure testing**
   - Set up Vitest configuration
   - Create test directory structure
   - Configure test database

8. **Set up CI/CD**
   - Create GitHub Actions workflows
   - Configure automated testing
   - Set up security scanning

## Validation

After running this skill, verify:
- [ ] All directories created successfully
- [ ] package.json with correct dependencies
- [ ] TypeScript compiles without errors
- [ ] ESLint passes
- [ ] Tests can be executed
- [ ] Docker build succeeds
- [ ] Git hooks are configured

## Next Steps

After project scaffolding is complete, proceed with:
1. Database schema design
2. OAuth2 integration setup
3. Core authentication system implementation

## Notes

- This skill should be run first before any other skills
- All generated files follow enterprise TypeScript best practices
- Security is configured from the start (ESLint security rules, strict TypeScript)
- The structure supports both development and production deployments
