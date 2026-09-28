import {
  fetchDeletionStatus,
  normalizeConfirmationCode,
} from '../../../meta-callback.proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: value } = await context.params;
  const code = normalizeConfirmationCode(value);
  if (!code) {
    return Response.json(
      { message: 'invalid confirmation code' },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  const forwardedFor =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    undefined;
  const status = await fetchDeletionStatus(code, forwardedFor);
  return Response.json(status, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
