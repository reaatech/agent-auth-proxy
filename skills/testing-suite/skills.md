# Skill: Testing Suite

## Overview

Develops comprehensive test coverage including unit, integration, security, and performance tests. Enforces a >85% code coverage threshold with CI gates that block PRs below the threshold.

## Metadata

- **Name**: Testing Suite
- **Description**: Unit, integration, security, and performance tests with >85% coverage enforcement
- **Complexity**: Medium
- **Estimated Time**: 4 hours
- **Dependencies**: Project Scaffolding, Database Schema

## Inputs

```typescript
interface TestingSuiteInputs {
  coverageThreshold?: number;       // Default: 85
  testDatabaseUrl?: string;
  mockKms?: boolean;                // Default: true
  includeSecurityTests?: boolean;   // Default: true
  includePerformanceTests?: boolean; // Default: true
}
```

## Outputs

### Test Configuration

#### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        'src/types/**',
        'scripts/**',
      ],
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': './src',
      '@auth': './src/auth',
      '@config': './src/config',
      '@db': './src/db',
      '@services': './src/services',
      '@types': './src/types',
      '@utils': './src/utils',
      '@proxy': './src/proxy',
    },
  },
});
```

#### tests/setup.ts

```typescript
import { beforeAll, afterAll, afterEach } from 'vitest';
import { db } from '@/db';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

beforeAll(async () => {
  // Run migrations on test database
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

afterEach(async () => {
  // Clean tables between tests
  const tables = ['oauth_tokens', 'api_keys', 'user_agent_grants', 'audit_logs', 'agents', 'users'];
  for (const table of tables) {
    await db.execute(`TRUNCATE TABLE ${table} CASCADE`);
  }
});

afterAll(async () => {
  // Close database connection
  // db connection cleanup
});
```

### Unit Tests

#### tests/unit/encryptionService.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { EncryptionService } from '@/auth/services/encryptionService';

describe('EncryptionService', () => {
  const service = new EncryptionService({ masterKey: 'a'.repeat(43) + '===' }); // base64 32 bytes

  it('should encrypt and decrypt data correctly', async () => {
    const plaintext = 'sensitive-api-key-12345';
    const { encrypted, iv } = await service.encrypt(plaintext);
    const decrypted = await service.decrypt(encrypted, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for same plaintext', async () => {
    const plaintext = 'test';
    const result1 = await service.encrypt(plaintext);
    const result2 = await service.encrypt(plaintext);
    expect(result1.encrypted).not.toBe(result2.encrypted);
  });

  it('should fail decryption with wrong IV', async () => {
    const { encrypted } = await service.encrypt('test');
    const wrongIv = Buffer.from('wrong-iv-16-byte');
    await expect(service.decrypt(encrypted, wrongIv)).rejects.toThrow();
  });
});
```

### Integration Tests

#### tests/integration/oauth2.test.ts

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '@/app';
import supertest from 'supertest';

describe('OAuth2 Integration', () => {
  let app: ReturnType<typeof supertest>;

  beforeAll(async () => {
    const fastify = await buildApp({
      oauth2: {
        redirectBaseUri: 'http://localhost:3000',
        providers: [
          {
            name: 'mock',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            authorizationUrl: 'http://mock-oauth/authorize',
            tokenUrl: 'http://mock-oauth/token',
            scopes: ['read'],
          },
        ],
      },
    });
    app = supertest(fastify.server);
  });

  it('should initiate OAuth authorization', async () => {
    const res = await app
      .get('/oauth/authorize?user_id=11111111-1111-1111-1111-111111111111&provider=mock&scopes=read');
    
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('mock-oauth/authorize');
    expect(res.headers.location).toContain('code_challenge');
  });

  it('should reject invalid state in callback', async () => {
    const res = await app
      .get('/oauth/mock/callback?code=123&state=invalid-state');
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Token exchange failed');
  });
});
```

### Security Tests

#### tests/security/scopeEscalation.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { ScopeEnforcer } from '@/auth/managers/scopeManager';
import { db } from '@/db';
import { users, agents, userAgentGrants, scopes } from '@/db/schema';

describe('Scope Escalation Prevention', () => {
  const enforcer = new ScopeEnforcer();

  it('should block never-granted scopes', async () => {
    const user = await createTestUser();
    const agent = await createTestAgent();
    await grantScopes(user.id, agent.id, ['email']);

    const result = await enforcer.validateRequest(user.id, agent.id, ['email', 'calendar'], 'google');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ESCALATION_ATTEMPT');
  });

  it('should block revoked scopes', async () => {
    const user = await createTestUser();
    const agent = await createTestAgent();
    await grantScopes(user.id, agent.id, ['email']);
    await revokeGrant(user.id, agent.id);

    const result = await enforcer.validateRequest(user.id, agent.id, ['email'], 'google');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ESCALATION_ATTEMPT');
  });

  it('should prevent credential leakage between users', async () => {
    const user1 = await createTestUser('user1@example.com');
    const user2 = await createTestUser('user2@example.com');
    const agent = await createTestAgent();
    await grantScopes(user1.id, agent.id, ['email']);

    const result = await enforcer.validateRequest(user2.id, agent.id, ['email'], 'google');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_SCOPES');
  });
});
```

### CI Coverage Gate

#### .github/workflows/ci.yml (coverage section)

```yaml
      - name: Run tests with coverage
        run: pnpm run test:coverage
        env:
          DATABASE_URL: postgresql://test_user:test_pass@localhost:5432/test_db
          
      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 85" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 85% threshold"
            exit 1
          fi
          echo "Coverage $COVERAGE% meets threshold"
```

## Validation

After running this skill, verify:
- [ ] All unit tests pass
- [ ] Integration tests pass with test database
- [ ] Security tests cover escalation, isolation, and injection scenarios
- [ ] Coverage report shows >85% lines, >85% functions, >80% branches
- [ ] CI pipeline fails if coverage drops below threshold
- [ ] Tests clean up database state between runs

## Next Steps

After testing suite:
1. Performance benchmarks and load tests
2. Mutation testing to verify test quality
3. Contract tests for downstream API compatibility
