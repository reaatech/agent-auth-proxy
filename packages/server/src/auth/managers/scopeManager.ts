import { db } from '@/db';
import { agents, scopes as scopesTable, userAgentGrants } from '@/db/schema';
import type { ScopeValidationResult } from '@reaatech/agent-auth-proxy-core';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

export class ScopeEnforcer {
  private cache = new Map<string, { scopes: string[]; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(cacheTtlMs = 60000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  async validateRequest(
    userId: string,
    agentId: string,
    requestedScopes: string[],
    provider: string,
  ): Promise<ScopeValidationResult> {
    if (!agentId) {
      return {
        allowed: false,
        reason: 'AGENT_INACTIVE',
        grantedScopes: [],
        requestedScopes,
      };
    }

    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });
    if (!agent || !agent.active) {
      return {
        allowed: false,
        reason: 'AGENT_INACTIVE',
        grantedScopes: [],
        requestedScopes,
      };
    }

    const cacheKey = `grants:${userId}:${agentId}`;
    const cached = this.cache.get(cacheKey);
    let activeScopes: string[];

    if (cached && cached.expiresAt > Date.now()) {
      activeScopes = cached.scopes;
    } else {
      const grants = await db.query.userAgentGrants.findMany({
        where: and(
          eq(userAgentGrants.userId, userId),
          eq(userAgentGrants.agentId, agentId),
          isNull(userAgentGrants.revokedAt),
          or(isNull(userAgentGrants.expiresAt), gt(userAgentGrants.expiresAt, new Date())),
        ),
      });

      activeScopes = grants.flatMap((g) => g.scopes);
      this.cache.set(cacheKey, { scopes: activeScopes, expiresAt: Date.now() + this.cacheTtlMs });
    }

    const providerScopes = await this.filterByProvider(activeScopes, provider);

    const missingScopes = requestedScopes.filter((s) => !providerScopes.includes(s));
    if (missingScopes.length > 0) {
      return {
        allowed: false,
        reason: 'INSUFFICIENT_SCOPES',
        grantedScopes: providerScopes,
        requestedScopes,
        missingScopes,
      };
    }

    const escalation = await this.detectEscalation(userId, agentId, requestedScopes);
    if (escalation) {
      return {
        allowed: false,
        reason: 'ESCALATION_ATTEMPT',
        grantedScopes: providerScopes,
        requestedScopes,
      };
    }

    return {
      allowed: true,
      grantedScopes: providerScopes,
      requestedScopes,
    };
  }

  private async detectEscalation(
    userId: string,
    agentId: string,
    requestedScopes: string[],
  ): Promise<boolean> {
    if (requestedScopes.length === 0) return false;

    const allGrants = await db.query.userAgentGrants.findMany({
      where: and(eq(userAgentGrants.userId, userId), eq(userAgentGrants.agentId, agentId)),
    });

    const everGrantedScopes = new Set(allGrants.flatMap((g) => g.scopes));
    const revokedScopes = allGrants.filter((g) => g.revokedAt !== null).flatMap((g) => g.scopes);

    const neverGranted = requestedScopes.some((s) => !everGrantedScopes.has(s));
    if (neverGranted) return true;

    const requestingRevoked = requestedScopes.some((s) => revokedScopes.includes(s));
    if (requestingRevoked) return true;

    const scopeRecords = await db.query.scopes.findMany({
      where: inArray(scopesTable.name, requestedScopes),
    });
    const agentRecord = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    const maxRisk =
      (agentRecord?.metadata as Record<string, string> | null)?.maxRiskLevel || 'high';
    const riskRank = { low: 1, medium: 2, high: 3 };
    const exceedingRisk = scopeRecords.some(
      (s) =>
        riskRank[s.riskLevel as keyof typeof riskRank] > riskRank[maxRisk as keyof typeof riskRank],
    );
    if (exceedingRisk) return true;

    return false;
  }

  private async filterByProvider(scopes: string[], provider: string): Promise<string[]> {
    const scopeRecords = await db.query.scopes.findMany({
      where: eq(scopesTable.provider, provider),
    });
    const validScopeNames = new Set(scopeRecords.map((s) => s.name));
    return scopes.filter((s) => validScopeNames.has(s));
  }

  invalidateCache(userId: string, agentId: string): void {
    this.cache.delete(`grants:${userId}:${agentId}`);
  }
}
