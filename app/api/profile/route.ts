import { NextRequest, NextResponse } from 'next/server';
import { getProfileSetting, setProfileSetting } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json(
        { success: false, error: 'Missing "key" parameter' },
        { status: 400 }
      );
    }

    // Password settings must only be handled by the dedicated auth endpoints.
    if (key !== 'history_row_count') {
      return NextResponse.json({ success: false, error: 'Setting is not accessible' }, { status: 403 });
    }
    const value = await getProfileSetting(key);

    return NextResponse.json({ success: true, key, value });
  } catch (error) {
    console.error('Error fetching profile setting:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing "key" or "value" in body' },
        { status: 400 }
      );
    }

    if (key !== 'history_row_count') {
      return NextResponse.json({ success: false, error: 'Setting is not writable' }, { status: 403 });
    }
    if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 1000) {
      return NextResponse.json({ success: false, error: 'Invalid history row count' }, { status: 400 });
    }
    const result = await setProfileSetting(key, String(value));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Error saving profile setting:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
