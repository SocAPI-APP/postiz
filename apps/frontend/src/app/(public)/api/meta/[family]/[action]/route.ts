import { forwardMetaCallback } from '../../meta-callback.proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ family: string; action: string }> }
) {
  const { family, action } = await context.params;
  return forwardMetaCallback(request, family, action);
}

export async function GET() {
  return Response.json(
    { message: 'method not allowed' },
    { status: 405, headers: { allow: 'POST' } }
  );
}
