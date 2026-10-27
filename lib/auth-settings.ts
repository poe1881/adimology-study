import { getProfileSetting, supabase } from './supabase';
import { verifySessionToken } from './auth';

export async function readPasswordState() {
  const [enabled, hash] = await Promise.all([
    getProfileSetting('password_enabled'), getProfileSetting('password_hash'),
  ]);
  // Never interpret a database error/missing settings as password protection being off.
  if (!['true', 'false'].includes(enabled ?? '') || typeof hash !== 'string' || (enabled === 'true' && !hash)) {
    throw new Error('Authentication settings unavailable');
  }
  return { enabled: enabled === 'true', hash };
}

export async function passwordVersion(hash: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hash));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export async function isPasswordSession(session: Awaited<ReturnType<typeof verifySessionToken>>, hash: string) {
  return !!hash && session?.authenticated === true && session.verified === true &&
    session.credentialVersion === await passwordVersion(hash);
}


/** One Postgres statement: never leave a new hash with an old enabled flag. */
export async function savePasswordState(hash: string, enabled: boolean) {
  const updated_at = new Date().toISOString();
  const { error } = await supabase.from('profile').upsert([
    { key: 'password_hash', value: hash, updated_at },
    { key: 'password_enabled', value: String(enabled), updated_at },
  ], { onConflict: 'key' });
  if (error) throw new Error('Unable to persist authentication settings');
}
