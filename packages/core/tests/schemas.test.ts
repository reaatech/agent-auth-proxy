import { describe, expect, it } from 'vitest';
import { oauthInitiateSchema, proxyParamsSchema, proxyRequestSchema } from '../src/schemas';

const VALID_UUID = '00000000-0000-0000-0000-000000000001';

describe('proxyParamsSchema', () => {
  it('accepts a valid provider/path pair', () => {
    expect(proxyParamsSchema.safeParse({ provider: 'google', path: 'calendar/v3' }).success).toBe(
      true,
    );
  });

  it('rejects providers with uppercase or spaces', () => {
    expect(proxyParamsSchema.safeParse({ provider: 'Google', path: 'x' }).success).toBe(false);
    expect(proxyParamsSchema.safeParse({ provider: 'goo gle', path: 'x' }).success).toBe(false);
  });

  it('rejects empty path', () => {
    expect(proxyParamsSchema.safeParse({ provider: 'google', path: '' }).success).toBe(false);
  });
});

describe('proxyRequestSchema', () => {
  it('requires UUIDs for userId and agentId', () => {
    expect(
      proxyRequestSchema.safeParse({
        provider: 'google',
        path: 'x',
        userId: 'not-a-uuid',
        agentId: VALID_UUID,
      }).success,
    ).toBe(false);

    expect(
      proxyRequestSchema.safeParse({
        provider: 'google',
        path: 'x',
        userId: VALID_UUID,
        agentId: VALID_UUID,
      }).success,
    ).toBe(true);
  });
});

describe('oauthInitiateSchema', () => {
  it('accepts a well-formed initiate request', () => {
    expect(
      oauthInitiateSchema.safeParse({
        user_id: VALID_UUID,
        provider: 'google',
        scopes: 'openid,email',
      }).success,
    ).toBe(true);
  });

  it('rejects scope strings over 512 chars', () => {
    expect(
      oauthInitiateSchema.safeParse({
        user_id: VALID_UUID,
        provider: 'google',
        scopes: 'a'.repeat(513),
      }).success,
    ).toBe(false);
  });
});
