import { describe, it, expect, afterEach, vi } from 'vitest';
import { api } from './api';

describe('api module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not include Authorization header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await api.getHealth();

    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(api.getHealth()).rejects.toThrow('not found');
  });

  it('getServerInfo calls /api/server/info', async () => {
    const mockData = { version: 'PG 19', max_connections: 100 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await api.getServerInfo();
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/server/info');
    expect(result.version).toBe('PG 19');
  });

  it('getTopQueries passes by and limit params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await api.getTopQueries('calls', 10);

    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    expect(url).toContain('by=calls');
    expect(url).toContain('limit=10');
  });
});
