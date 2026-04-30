export type ScopeValidationFailureReason =
  | 'INSUFFICIENT_SCOPES'
  | 'ESCALATION_ATTEMPT'
  | 'GRANT_EXPIRED'
  | 'AGENT_INACTIVE';

export interface ScopeValidationResult {
  allowed: boolean;
  reason?: ScopeValidationFailureReason;
  grantedScopes: string[];
  requestedScopes: string[];
  missingScopes?: string[];
}
