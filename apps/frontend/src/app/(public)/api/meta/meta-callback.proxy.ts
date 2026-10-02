export type PublicMetaFamily = 'facebook' | 'instagram' | 'threads';
export type MetaCallbackAction = 'deauthorize' | 'data-deletion';

export type DeletionStatus = {
  code: string;
  status: 'completed' | 'unknown';
  requestedAt?: string;
  completedAt?: string;
  channels?: number;
};

const BACKEND_FAMILY: Record<PublicMetaFamily, string> = {
  facebook: 'facebook',
  instagram: 'instagram-standalone',
  threads: 'threads',
};
const MAX_CALLBACK_BODY_BYTES = 12 * 1024;
const CONFIRMATION_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

export const backendBase = (): string =>
  (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    ''
  ).replace(/\/+$/, '');

export const normalizeConfirmationCode = (value: unknown): string | null => {
  const code = String(value || '')
    .trim()
    .toUpperCase();
  return CONFIRMATION_CODE_PATTERN.test(code) ? code : null;
};

export const backendCallbackPath = (
  family: string,
  action: string
): string | null => {
  if (!Object.prototype.hasOwnProperty.call(BACKEND_FAMILY, family)) {
    return null;
  }
  if (action !== 'deauthorize' && action !== 'data-deletion') {
    return null;
  }

  return `/integrations/meta/${
    BACKEND_FAMILY[family as PublicMetaFamily]
  }/${action}`;
};

export async function forwardMetaCallback(
  request: Request,
  family: string,
  action: string
): Promise<Response> {
  const path = backendCallbackPath(family, action);
  if (!path) {
    return Response.json({ message: 'not found' }, { status: 404 });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_CALLBACK_BODY_BYTES) {
    return Response.json(
      { message: 'request body too large' },
      { status: 413 }
    );
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_CALLBACK_BODY_BYTES) {
    return Response.json(
      { message: 'request body too large' },
      { status: 413 }
    );
  }

  const base = backendBase();
  if (!base) {
    return Response.json(
      { message: 'backend not configured' },
      { status: 500 }
    );
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  let upstream: Response;
  try {
    upstream = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type':
          request.headers.get('content-type') ||
          'application/x-www-form-urlencoded',
        'user-agent':
          request.headers.get('user-agent') || 'socapi-meta-callback-proxy',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(realIp ? { 'x-real-ip': realIp } : {}),
      },
      body,
      cache: 'no-store',
    });
  } catch {
    return Response.json({ message: 'backend unavailable' }, { status: 502 });
  }

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export async function fetchDeletionStatus(
  code: string,
  forwardedFor?: string
): Promise<DeletionStatus> {
  const normalized = normalizeConfirmationCode(code);
  if (!normalized) {
    return { code: String(code || ''), status: 'unknown' };
  }

  const base = backendBase();
  if (!base) {
    return { code: normalized, status: 'unknown' };
  }

  try {
    const response = await fetch(
      `${base}/integrations/meta/data-deletion/${encodeURIComponent(
        normalized
      )}`,
      {
        headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : undefined,
        cache: 'no-store',
      }
    );
    if (!response.ok) {
      return { code: normalized, status: 'unknown' };
    }

    const status = (await response.json()) as DeletionStatus;
    return {
      code: normalized,
      status: status.status === 'completed' ? 'completed' : 'unknown',
      ...(status.requestedAt ? { requestedAt: status.requestedAt } : {}),
      ...(status.completedAt ? { completedAt: status.completedAt } : {}),
      ...(typeof status.channels === 'number'
        ? { channels: status.channels }
        : {}),
    };
  } catch {
    return { code: normalized, status: 'unknown' };
  }
}
