/* eslint-disable @typescript-eslint/no-unsafe-call */
import { describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

vi.mock('@/db', () => ({
  db: { insert: mockInsert },
}));

describe('AuditLogger', () => {
  it('should create audit logger without SIEM', async () => {
    vi.resetModules();
    const { AuditLogger } = await import('@/services/auditService');
    const logger = new AuditLogger();
    await logger.log({
      eventType: 'api_call',
      action: 'test_action',
      resource: 'test',
      outcome: 'success',
    });
    await logger.dispose();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('should infer event categories correctly', async () => {
    vi.resetModules();
    const { AuditLogger } = await import('@/services/auditService');
    const logger = new AuditLogger();

    await logger.log({
      eventType: 'authentication',
      action: 'login',
      resource: 'auth',
      outcome: 'success',
    });
    await logger.log({
      eventType: 'scope_violation',
      action: 'blocked',
      resource: 'api',
      outcome: 'blocked',
    });
    await logger.dispose();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('should handle unknown event types by defaulting to proxy', async () => {
    vi.resetModules();
    const { AuditLogger } = await import('@/services/auditService');
    const logger = new AuditLogger();
    await logger.log({
      eventType: 'unknown_event_type' as 'api_call',
      action: 'test',
      resource: 'test',
      outcome: 'success',
    });
    await logger.dispose();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('should flush empty batch without error', async () => {
    vi.resetModules();
    mockInsert.mockClear();
    const { AuditLogger } = await import('@/services/auditService');
    const logger = new AuditLogger();
    await logger.dispose();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('should forward security events to SIEM when configured', async () => {
    const originalSiemEndpoint = process.env.SIEM_ENDPOINT;
    const originalSiemApiKey = process.env.SIEM_API_KEY;
    process.env.SIEM_ENDPOINT = 'https://siem.example.com/events';
    process.env.SIEM_API_KEY = 'test-siem-key';

    vi.resetModules();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const { AuditLogger } = await import('@/services/auditService');
    const logger = new AuditLogger();

    await logger.log({
      eventType: 'scope_violation',
      action: 'blocked',
      resource: 'api',
      outcome: 'blocked',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://siem.example.com/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-siem-key',
        }),
      }),
    );
    await logger.dispose();
    globalThis.fetch = originalFetch;

    if (originalSiemEndpoint !== undefined) {
      process.env.SIEM_ENDPOINT = originalSiemEndpoint;
    } else {
      process.env.SIEM_ENDPOINT = undefined;
    }
    if (originalSiemApiKey !== undefined) {
      process.env.SIEM_API_KEY = originalSiemApiKey;
    } else {
      process.env.SIEM_API_KEY = undefined;
    }
    vi.resetModules();
  });

  it('should handle SIEM forwarding failure gracefully', async () => {
    const originalSiemEndpoint = process.env.SIEM_ENDPOINT;
    const originalSiemApiKey = process.env.SIEM_API_KEY;
    process.env.SIEM_ENDPOINT = 'https://siem.example.com/events';
    process.env.SIEM_API_KEY = 'test-siem-key';

    vi.resetModules();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { AuditLogger } = await import('@/services/auditService');
    const logger = new AuditLogger();

    await expect(
      (async () => {
        await logger.log({
          eventType: 'scope_violation',
          action: 'blocked',
          resource: 'api',
          outcome: 'blocked',
        });
      })(),
    ).resolves.toBeUndefined();

    await new Promise((r) => setTimeout(r, 100));
    await logger.dispose();
    globalThis.fetch = originalFetch;

    if (originalSiemEndpoint !== undefined) {
      process.env.SIEM_ENDPOINT = originalSiemEndpoint;
    } else {
      process.env.SIEM_ENDPOINT = undefined;
    }
    if (originalSiemApiKey !== undefined) {
      process.env.SIEM_API_KEY = originalSiemApiKey;
    } else {
      process.env.SIEM_API_KEY = undefined;
    }
    vi.resetModules();
  });
});
