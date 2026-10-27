import { verifyPassword } from '@/lib/password';
import { NextRequest, NextResponse } from 'next/server';
import { setSession } from '@/lib/auth';
import { passwordVersion, readPasswordState } from '@/lib/auth-settings';


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (typeof password !== 'string' || !password || password.length > 1024) {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { status: 400 }
      );
    }

    const { hash: storedHash } = await readPasswordState();

    if (!storedHash) {
      return NextResponse.json(
        { success: false, error: 'No password has been set' },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(password, storedHash);

    if (valid) {
      const response = NextResponse.json({ success: true, valid: true });
      await setSession(response, true, await passwordVersion(storedHash));
      return response;
    }

    return NextResponse.json({ success: true, valid: false });
  } catch (error) {
    console.error('Error verifying password:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
