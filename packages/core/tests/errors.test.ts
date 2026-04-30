import { describe, expect, it } from 'vitest';
import { AppError, AuthError, ScopeError, UpstreamError, ValidationError } from '../src/errors';

describe('Error classes', () => {
  it('AppError stores code, message, statusCode, and details', () => {
    const err = new AppError('TEST_CODE', 'something failed', 418, { foo: 'bar' });
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('something failed');
    expect(err.statusCode).toBe(418);
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('AppError defaults statusCode to 500', () => {
    const err = new AppError('X', 'y');
    expect(err.statusCode).toBe(500);
  });

  it('AuthError uses 401 and is an AppError', () => {
    const err = new AuthError('AUTH_FAILED', 'no token');
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('AuthError');
    expect(err).toBeInstanceOf(AppError);
  });

  it('ScopeError uses 403', () => {
    const err = new ScopeError('SCOPE_DENIED', 'missing read scope');
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('ScopeError');
  });

  it('ValidationError uses 400 and code VALIDATION_ERROR', () => {
    const err = new ValidationError('email is required');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
  });

  it('UpstreamError uses 502 and code UPSTREAM_ERROR', () => {
    const err = new UpstreamError('downstream timed out');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.name).toBe('UpstreamError');
  });
});
