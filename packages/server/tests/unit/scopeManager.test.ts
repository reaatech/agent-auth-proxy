import { ScopeEnforcer } from '@/auth/managers/scopeManager';
import { db } from '@/db';
import { agents, scopes as scopesTable, userAgentGrants, users } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('ScopeEnforcer', () => {
  const userId = '00000000-0000-0000-0000-000000000010';
  const agentId = '00000000-0000-0000-0000-000000000011';

  describe('validation', () => {
    let enforcer: ScopeEnforcer;

    beforeEach(() => {
      enforcer = new ScopeEnforcer(1000);
    });

    async function createUser(email: string) {
      const [user] = await db.insert(users).values({ email }).returning();
      return user;
    }

    async function createAgent(name: string, active = true) {
      const [agent] = await db
        .insert(agents)
        .values({ name, apiKeyHash: 'hash', apiKeyPrefix: 'pref', active })
        .returning();
      return agent;
    }

    async function createScope(name: string, provider: string, riskLevel = 'low') {
      await db
        .insert(scopesTable)
        .values({ name, provider, category: 'read', riskLevel })
        .onConflictDoNothing();
    }

    async function grantScopes(userId: string, agentId: string, scopes: string[]) {
      await db.insert(userAgentGrants).values({ userId, agentId, scopes });
    }

    it('should allow requests with granted scopes', async () => {
      const user = await createUser('test@example.com');
      const agent = await createAgent('test-agent');
      await createScope('email', 'google');
      await grantScopes(user.id, agent.id, ['email']);

      const result = await enforcer.validateRequest(user.id, agent.id, ['email'], 'google');
      expect(result.allowed).toBe(true);
    });

    it('should block requests with missing scopes', async () => {
      const user = await createUser('test2@example.com');
      const agent = await createAgent('test-agent-2');
      await createScope('email', 'google');
      await createScope('calendar', 'google');
      await grantScopes(user.id, agent.id, ['email']);

      const result = await enforcer.validateRequest(
        user.id,
        agent.id,
        ['email', 'calendar'],
        'google',
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_SCOPES');
    });

    it('should block inactive agents', async () => {
      const user = await createUser('test3@example.com');
      const agent = await createAgent('inactive', false);

      const result = await enforcer.validateRequest(user.id, agent.id, ['email'], 'google');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('AGENT_INACTIVE');
    });
  });

  describe('escalation and caching', () => {
    const enforcer = new ScopeEnforcer();

    beforeEach(async () => {
      await db.delete(userAgentGrants).where(sql.raw(`"user_id" = '${userId}'`));
      await db.delete(agents).where(eq(agents.id, agentId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(scopesTable).where(eq(scopesTable.provider, 'test'));
      enforcer.cache.clear();
    });

    it('should detect scope escalation for exceeding risk level', async () => {
      await db
        .insert(users)
        .values({ id: userId, email: 'escalation@example.com' })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({
          id: agentId,
          name: 'escalation-agent',
          active: true,
          apiKeyHash: 'hash',
          apiKeyPrefix: 'pref',
          metadata: { maxRiskLevel: 'low' },
        })
        .onConflictDoNothing();
      await db
        .insert(scopesTable)
        .values([
          { name: 'read', provider: 'test', category: 'data', riskLevel: 'low' },
          { name: 'write', provider: 'test', category: 'data', riskLevel: 'medium' },
        ])
        .onConflictDoNothing();
      await db.insert(userAgentGrants).values({ userId, agentId, scopes: ['read', 'write'] });

      const result = await enforcer.validateRequest(userId, agentId, ['write'], 'test');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ESCALATION_ATTEMPT');
    });

    it('should use cache on second request', async () => {
      await db
        .insert(users)
        .values({ id: userId, email: 'cache@example.com' })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({
          id: agentId,
          name: 'cache-agent',
          active: true,
          apiKeyHash: 'hash',
          apiKeyPrefix: 'pref',
        })
        .onConflictDoNothing();
      await db
        .insert(scopesTable)
        .values({ name: 'read', provider: 'test', category: 'data', riskLevel: 'low' })
        .onConflictDoNothing();
      await db.insert(userAgentGrants).values({ userId, agentId, scopes: ['read'] });

      const result1 = await enforcer.validateRequest(userId, agentId, ['read'], 'test');
      expect(result1.allowed).toBe(true);
      expect(enforcer.cache.size).toBeGreaterThan(0);

      const result2 = await enforcer.validateRequest(userId, agentId, ['read'], 'test');
      expect(result2.allowed).toBe(true);
    });

    it('should invalidate cache', async () => {
      await db
        .insert(users)
        .values({ id: userId, email: 'cache@example.com' })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({
          id: agentId,
          name: 'cache-agent',
          active: true,
          apiKeyHash: 'hash',
          apiKeyPrefix: 'pref',
        })
        .onConflictDoNothing();
      await db
        .insert(scopesTable)
        .values({ name: 'read', provider: 'test', category: 'data', riskLevel: 'low' })
        .onConflictDoNothing();
      await db.insert(userAgentGrants).values({ userId, agentId, scopes: ['read'] });

      await enforcer.validateRequest(userId, agentId, ['read'], 'test');
      expect(enforcer.cache.size).toBeGreaterThan(0);

      enforcer.invalidateCache(userId, agentId);
      expect(enforcer.cache.size).toBe(0);
    });
  });
});
