import { NextResponse } from 'next/server';
import { verifySessionToken, setSession } from '@/lib/auth';
import { isPasswordSession, readPasswordState } from '@/lib/auth-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const state = await readPasswordState();
    const cookie = (request.headers.get('cookie') || '').split(';')
      .map(c => c.trim()).find(c => c.startsWith('adimology_session='));
    const token = cookie?.slice('adimology_session='.length);
    const session = token ? await verifySessionToken(token) : null;
    const verified = await isPasswordSession(session, state.hash);
    const result = {
      success: true, enabled: state.enabled, hasPassword: !!state.hash,
      isAuthenticated: state.enabled ? verified : true,
    };
    const response = NextResponse.json(result);
    response.headers.set('Cache-Control', 'no-store');
    // Never downgrade an already password-verified session to a guest.
    if (!state.enabled && !verified) await setSession(response, false);
    return response;
  } catch {
    return NextResponse.json({ success: false, error: 'Authentication unavailable' }, { status: 503 });
  }
}
