import { describe, it, expect, afterEach, vi } from 'vitest';
import { api } from './api';

function okResponse(body: unknown = { status: 'ok' }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('api module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    api.setToken(null);
    api.setUser(null);
    api.onUnauthorized(null);
  });

  it('sends no Authorization header when no one is logged in', async () => {
    // The common case: auth disabled on the backend, so every request is
    // anonymous and an empty Bearer header would be a lie.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    await api.getHealth();

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('sends the stored token once one is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    api.setToken('jwt-abc');

    await api.getHealth();

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
  });

  it('round-trips token and user through storage, and clears them with null', () => {
    api.setToken('jwt-abc');
    api.setUser('admin');
    expect(api.getToken()).toBe('jwt-abc');
    expect(api.getUser()).toBe('admin');

    api.setToken(null);
    api.setUser(null);
    expect(api.getToken()).toBeNull();
    expect(api.getUser()).toBeNull();
  });

  it('reports a 401 to the registered handler, and still throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ error: 'invalid or expired token' }, 401));
    const onUnauthorized = vi.fn();
    api.onUnauthorized(onUnauthorized);

    await expect(api.getHealth()).rejects.toThrow('invalid or expired token');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('leaves other failures to the caller', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ error: 'boom' }, 500));
    const onUnauthorized = vi.fn();
    api.onUnauthorized(onUnauthorized);

    await expect(api.getHealth()).rejects.toThrow('boom');
    expect(onUnauthorized).not.toHaveBeenCalled();
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
