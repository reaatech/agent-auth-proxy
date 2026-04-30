import {
  AppError,
  AuthError,
  ScopeError,
  UpstreamError,
  ValidationError,
} from '@reaatech/agent-auth-proxy-core';
import { describe, expect, it } from 'vitest';

describe('Error classes', () => {
  it('AppError should have correct properties', () => {
    const err = new AppError('TEST_CODE', 'Test message', 418, { foo: 'bar' });
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('Test message');
    expect(err.statusCode).toBe(418);
    expect(err.details).toEqual({ foo: 'bar' });
  });

  it('AuthError should default to 401', () => {
    const err = new AuthError('AUTH_FAIL', 'Auth failed');
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('AuthError');
  });

  it('ScopeError should default to 403', () => {
    const err = new ScopeError('SCOPE_FAIL', 'Scope failed');
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('ScopeError');
  });

  it('ValidationError should default to 400', () => {
    const err = new ValidationError('Bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('UpstreamError should default to 502', () => {
    const err = new UpstreamError('Upstream down');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
  });
});
