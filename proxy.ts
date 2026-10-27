import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from './lib/auth';
import { isPasswordSession, readPasswordState } from './lib/auth-settings';

const PUBLIC_PATHS = new Set([
  '/api/auth/verify-password', '/api/auth/check-password', '/api/auth/set-password',
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/api/') || PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  // A cron credential is not an administrator credential.
  const cronSecret = process.env.CRON_SECRET;
  const cronPaths = new Set(['/api/analyze-watchlist', '/api/job-retry']);
  if (cronPaths.has(pathname) && cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }
  const token = request.cookies.get('adimology_session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return unauthorized();
  try {
    const state = await readPasswordState();
    if (state.enabled && !await isPasswordSession(session, state.hash)) return unauthorized();
    return NextResponse.next();
  } catch {
    return NextResponse.json({ success: false, error: 'Authentication unavailable' }, { status: 503 });
  }
}

function unauthorized() {
  const response = NextResponse.json({ success: false, error: 'Unauthorized: login required' }, { status: 401 });
  response.cookies.delete('adimology_session');
  return response;
}

export const config = { matcher: '/api/:path*' };
