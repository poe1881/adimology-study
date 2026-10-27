import { hashPassword, verifyPassword } from '@/lib/password';
import { NextRequest, NextResponse } from 'next/server';

import { isPasswordSession, readPasswordState, savePasswordState } from '@/lib/auth-settings';
import { clearSession, verifySessionToken } from '@/lib/auth';


export async function POST(request: NextRequest) {
  try {
    // Public in the proxy solely to permit narrowly constrained local bootstrap.
    const token = request.cookies.get('adimology_session')?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session || session.authenticated !== true) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }
    const { hash: storedHash } = await readPasswordState();
    if (storedHash && !await isPasswordSession(session, storedHash)) {
      return NextResponse.json({ success: false, error: 'Password-verified session required' }, { status: 403 });
    }
    const url = new URL(request.url);
    const originHeader = request.headers.get('origin');
    let sameOrigin = originHeader === url.origin;
    if (!sameOrigin && originHeader && process.env.NODE_ENV !== 'production') {
      try {
        const origin = new URL(originHeader);
        const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
        // NextRequest normalizes loopback hostnames to localhost.
        sameOrigin = loopback.has(origin.hostname) && loopback.has(url.hostname) &&
          origin.protocol === url.protocol && origin.port === url.port;
      } catch { /* malformed Origin is denied */ }
    }
    if (!sameOrigin) {
      return NextResponse.json({ success: false, error: 'Same-origin request required' }, { status: 403 });
    }
    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ success: false, error: 'enabled must be boolean' }, { status: 400 });
    }
    const { password, enabled, currentPassword } = body;
    if (!storedHash && (process.env.NODE_ENV === 'production' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !enabled)) {
      return NextResponse.json({ success: false, error: 'Initial setup must enable a password locally in development' }, { status: 403 });
    }
    if (enabled && (typeof password !== 'string' || password.length < 12 || password.length > 1024)) {
      return NextResponse.json({ success: false, error: 'Password harus 12–1024 karakter' }, { status: 400 });
    }
    if (storedHash && (typeof currentPassword !== 'string' || currentPassword.length > 1024 ||
        !await verifyPassword(currentPassword, storedHash))) {
      return NextResponse.json({ success: false, error: 'Current password required' }, { status: 403 });
    }
    // Retain the verifier when disabling so re-enabling still requires the owner.
    await savePasswordState(enabled ? await hashPassword(password) : storedHash, enabled);
    const response = NextResponse.json({ success: true });
    await clearSession(response);
    return response;
  } catch (error) {
    console.error('Error setting password:', error);
    return NextResponse.json({ success: false, error: 'Unable to update authentication settings' }, { status: 503 });
  }
}
