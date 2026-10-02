import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GET as callbackGet,
  POST as callbackPost,
} from './[family]/[action]/route';
import { GET as statusGet } from './data-deletion/status/[code]/route';

const fetchMock = vi.fn();
const savedEnv = { ...process.env };

const metaRequest = (body = 'signed_request=abc.def') =>
  new Request('https://socapi.app/api/meta/facebook/deauthorize', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'facebookplatform/1.0',
    },
    body,
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BACKEND_INTERNAL_URL = 'http://127.0.0.1:4300/';
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe('public Meta callback proxy', () => {
  it.each([
    ['facebook', 'deauthorize', '/integrations/meta/facebook/deauthorize'],
    ['facebook', 'data-deletion', '/integrations/meta/facebook/data-deletion'],
    [
      'instagram',
      'deauthorize',
      '/integrations/meta/instagram-standalone/deauthorize',
    ],
    [
      'instagram',
      'data-deletion',
      '/integrations/meta/instagram-standalone/data-deletion',
    ],
    ['threads', 'deauthorize', '/integrations/meta/threads/deauthorize'],
    ['threads', 'data-deletion', '/integrations/meta/threads/data-deletion'],
  ])(
    'maps %s/%s to the family-specific backend route',
    async (family, action, backendPath) => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ ok: true, channels: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const response = await callbackPost(metaRequest(), {
        params: Promise.resolve({ family, action }),
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `http://127.0.0.1:4300${backendPath}`,
        expect.objectContaining({
          method: 'POST',
          body: 'signed_request=abc.def',
          headers: expect.objectContaining({
            'content-type': 'application/x-www-form-urlencoded',
          }),
        })
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  );

  it('relays a backend signature failure unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'invalid signed_request' }), {
        status: 400,
      })
    );
    const response = await callbackPost(metaRequest(), {
      params: Promise.resolve({
        family: 'facebook',
        action: 'deauthorize',
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: 'invalid signed_request',
    });
  });

  it('rejects unsupported routes without contacting the backend', async () => {
    const response = await callbackPost(metaRequest(), {
      params: Promise.resolve({ family: 'unknown', action: 'deauthorize' }),
    });
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized callback bodies', async () => {
    const response = await callbackPost(metaRequest('x'.repeat(13 * 1024)), {
      params: Promise.resolve({ family: 'facebook', action: 'deauthorize' }),
    });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 405 for GET callback requests', async () => {
    const response = await callbackGet();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('returns 502 when the backend is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const response = await callbackPost(metaRequest(), {
      params: Promise.resolve({ family: 'threads', action: 'deauthorize' }),
    });
    expect(response.status).toBe(502);
  });
});

describe('public deletion status proxy', () => {
  it('returns a completed status from the backend', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'ABCDEFGH2345',
          status: 'completed',
          requestedAt: '2026-09-29T00:00:00.000Z',
          completedAt: '2026-09-29T00:00:01.000Z',
          channels: 1,
          token: 'must-not-pass-through',
        }),
        { status: 200 }
      )
    );
    const response = await statusGet(
      new Request(
        'https://socapi.app/api/meta/data-deletion/status/ABCDEFGH2345'
      ),
      { params: Promise.resolve({ code: 'abcdefgh2345' }) }
    );
    expect(await response.json()).toEqual({
      code: 'ABCDEFGH2345',
      status: 'completed',
      requestedAt: '2026-09-29T00:00:00.000Z',
      completedAt: '2026-09-29T00:00:01.000Z',
      channels: 1,
    });
  });

  it('returns unknown for an unseen code', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'ABCDEFGH2345', status: 'unknown' }),
        { status: 200 }
      )
    );
    const response = await statusGet(
      new Request(
        'https://socapi.app/api/meta/data-deletion/status/ABCDEFGH2345'
      ),
      { params: Promise.resolve({ code: 'ABCDEFGH2345' }) }
    );
    expect(await response.json()).toEqual({
      code: 'ABCDEFGH2345',
      status: 'unknown',
    });
  });

  it('returns 400 for an invalid confirmation code', async () => {
    const response = await statusGet(
      new Request('https://socapi.app/api/meta/data-deletion/status/bad'),
      { params: Promise.resolve({ code: 'bad' }) }
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
