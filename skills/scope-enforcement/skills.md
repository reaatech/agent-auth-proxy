# Skill: Scope Enforcement

## Overview

Implements scope validation, permission checking, and scope escalation prevention. Scopes are granted per user-agent pair and validated on every proxied request. The enforcer prevents agents from accessing scopes that were never granted or have been revoked.

## Metadata

- **Name**: Scope Enforcement
- **Description**: Per-request scope validation with escalation detection and audit logging
- **Complexity**: High
- **Estimated Time**: 3 hours
- **Dependencies**: Project Scaffolding, Database Schema

## Inputs

```typescript
interface ScopeEnforcementInputs {
  defaultRiskCeiling?: 'low' | 'medium' | 'high';  // Default: 'high'
  requireExplicitScopes?: boolean;                  // Default: false (allow implicit read scopes)
  cacheGrantsMs?: number;                           // Default: 60000
}
```

## Outputs

### Core Scope Enforcer

#### src/auth/managers/scopeManager.ts

```typescript
import { eq, and, isNull, or, gt } from 'drizzle-orm';
import { db } from '@/db';
import { userAgentGrants, scopes, agents } from '@/db/schema';

export interface ValidationResult {
  allowed: boolean;
  reason?: 'INSUFFICIENT_SCOPES' | 'ESCALATION_ATTEMPT' | 'GRANT_EXPIRED' | 'AGENT_INACTIVE';
  grantedScopes: string[];
  requestedScopes: string[];
  missingScopes?: string[];
}

export class ScopeEnforcer {
  private cache = new Map<string, { scopes: string[]; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(config: ScopeEnforcementInputs = {}) {
    this.cacheTtlMs = config.cacheGrantsMs || 60000;
  }

  async validateRequest(
    userId: string,
    agentId: string,
    requestedScopes: string[],
    provider: string
  ): Promise<ValidationResult> {
    // 1. Verify agent is active
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

    // 2. Get active grants from cache or database
    const cacheKey = `grants:${userId}:${agentId}:${provider}`;
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
          or(
            isNull(userAgentGrants.expiresAt),
            gt(userAgentGrants.expiresAt, new Date())
          )
        ),
      });
      
      activeScopes = grants.flatMap(g => g.scopes);
      this.cache.set(cacheKey, { scopes: activeScopes, expiresAt: Date.now() + this.cacheTtlMs });
    }

    // 3. Filter by provider
    const providerScopes = await this.filterByProvider(activeScopes, provider);

    // 4. Check requested scopes
    const missingScopes = requestedScopes.filter(s => !providerScopes.includes(s));
    if (missingScopes.length > 0) {
      return {
        allowed: false,
        reason: 'INSUFFICIENT_SCOPES',
        grantedScopes: providerScopes,
        requestedScopes,
        missingScopes,
      };
    }

    // 5. Check for escalation (previously revoked or never-granted scopes)
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

  /**
   * Detect scope escalation attempts.
   * An escalation occurs when an agent requests scopes that:
   * 1. Were never granted to this user-agent pair, OR
   * 2. Were previously granted but revoked, OR
   * 3. Exceed the maximum risk level allowed for this agent
   */
  private async detectEscalation(
    userId: string,
    agentId: string,
    requestedScopes: string[]
  ): Promise<boolean> {
    // Get all historical grants (including revoked)
    const allGrants = await db.query.userAgentGrants.findMany({
      where: and(
        eq(userAgentGrants.userId, userId),
        eq(userAgentGrants.agentId, agentId)
      ),
    });

    const everGrantedScopes = new Set(allGrants.flatMap(g => g.scopes));
    const revokedScopes = allGrants
      .filter(g => g.revokedAt !== null)
      .flatMap(g => g.scopes);

    // Check for never-granted scopes
    const neverGranted = requestedScopes.some(s => !everGrantedScopes.has(s));
    if (neverGranted) return true;

    // Check for requesting revoked scopes
    const requestingRevoked = requestedScopes.some(s => revokedScopes.includes(s));
    if (requestingRevoked) return true;

    // Check risk level ceiling
    const scopeRecords = await db.query.scopes.findMany({
      where: eq(scopes.name, requestedScopes as any), // Drizzle IN query
    });
    const agentRecord = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });
    const maxRisk = (agentRecord?.metadata as any)?.maxRiskLevel || 'high';
    const riskRank = { low: 1, medium: 2, high: 3 };
    const exceedingRisk = scopeRecords.some(
      s => riskRank[s.riskLevel as keyof typeof riskRank] > riskRank[maxRisk as keyof typeof riskRank]
    );
    if (exceedingRisk) return true;

    return false;
  }

  private async filterByProvider(scopes: string[], provider: string): Promise<string[]> {
    // If scopes already include provider prefix, filter directly
    // Otherwise, lookup in scopes table
    const scopeRecords = await db.query.scopes.findMany({
      where: eq(scopes.provider, provider),
    });
    const validScopeNames = new Set(scopeRecords.map(s => s.name));
    return scopes.filter(s => validScopeNames.has(s));
  }

  invalidateCache(userId: string, agentId: string): void {
    const prefix = `grants:${userId}:${agentId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }
}
```

## Validation

After running this skill, verify:
- [ ] Granted scopes allow requests through
- [ ] Missing scopes return 403 with `INSUFFICIENT_SCOPES`
- [ ] Revoked scopes trigger `ESCALATION_ATTEMPT`
- [ ] Never-granted scopes trigger `ESCALATION_ATTEMPT`
- [ ] Inactive agents are blocked with `AGENT_INACTIVE`
- [ ] Expired grants are not honored
- [ ] Cache invalidation works on grant changes
- [ ] Risk level ceilings are enforced

## Security Considerations

- Scope validation must run on every request — do not skip for "trusted" agents
- Cache TTL should be short (≤ 60s) to minimize window where revoked grants are still valid
- Escalation attempts must be logged as security events with full context
- The `scopes` reference table should be seeded with known provider scopes; unknown scopes default to `high` risk

## Next Steps

After scope enforcement:
1. Proxy engine integration (validate before forwarding)
2. Admin UI for grant management
3. Automated scope discovery from OAuth providers
