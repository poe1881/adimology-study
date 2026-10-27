import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const TEST_HASH = createHash('sha256').update('synthetic-test-only').digest('hex');
import { NextRequest } from 'next/server';

// Isolated test configuration: never load .env.local or contact a real database.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-placeholder';
process.env.AUTH_SECRET = 'isolated-test-secret-not-a-real-credential-12345';
const { supabase } = await import('../lib/supabase');
const state: Record<string, string> = {};
let writes = 0;
let failWrite = false;
(supabase as any).from = () => {
  let key: string;
  let error: object | null = null;
  const builder: any = {
    select: () => builder,
    eq: (_field: string, value: string) => { key = value; return builder; },
    upsert: (row: any) => {
      writes++;
      if (failWrite) { error = { message: 'simulated database failure' }; return builder; }
      for (const item of Array.isArray(row) ? row : [row]) { state[item.key] = item.value; key = item.key; }
      return builder;
    },
    then: (resolve: any) => Promise.resolve({ data: [], error }).then(resolve),
    single: async () => ({ data: { key, value: state[key] ?? null }, error: null }),
  };
  return builder;
};
const { POST } = await import('../app/api/auth/set-password/route');
const { GET: getProfile, PUT: putProfile } = await import('../app/api/profile/route');
const { proxy } = await import('../proxy');
const auth = await import('../lib/auth');
const { passwordVersion } = await import('../lib/auth-settings');
const { POST: login } = await import('../app/api/auth/verify-password/route');
const { GET: checkPassword } = await import('../app/api/auth/check-password/route');

async function request(path: string, body?: unknown, verified = false, origin = 'http://127.0.0.1:3000') {
  if (verified && path === '/api/auth/set-password' && body && typeof body === 'object') {
    body = { currentPassword: 'synthetic-test-only', ...body };
  }
  const token = await auth.createSessionToken({ authenticated: true, verified,
    credentialVersion: verified ? await passwordVersion(state.password_hash) : undefined });
  return new NextRequest('http://127.0.0.1:3000' + path, {
    method: body === undefined ? 'GET' : path === '/api/profile' ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: `adimology_session=${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  state.password_enabled = 'true';
  state.password_hash = TEST_HASH;
  writes = 0;
  failWrite = false;
});

test('anonymous request cannot disable an existing password or write settings', async () => {
  const response = await POST(new NextRequest('http://127.0.0.1:3000/api/auth/set-password', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({ enabled: false }),
  }));
  assert.equal(response.status, 401);
  assert.equal(writes, 0);
  assert.equal(state.password_enabled, 'true');
});


test('generic profile API cannot overwrite password settings', async () => {
  const response = await putProfile(await request('/api/profile', { key: 'password_enabled', value: 'false' }, true));
  assert.equal(response.status, 403);
  assert.equal(writes, 0);
});

test('generic profile API cannot disclose password hash', async () => {
  const response = await getProfile(await request('/api/profile?key=password_hash', undefined, true));
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes(TEST_HASH));
});


test('guest session cannot access protected API after password is enabled', async () => {
  const response = await proxy(await request('/api/summary'));
  assert.equal(response.status, 401);
});

test('missing AUTH_SECRET cannot sign a session with a public fallback', async () => {
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try { await assert.rejects(() => auth.createSessionToken({ authenticated: true })); }
  finally { process.env.AUTH_SECRET = saved; }
});


test('guest cannot change an existing password', async () => {
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: false }))).status, 403);
  assert.equal(writes, 0);
});
test('cross-origin password change is rejected', async () => {
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: false }, true, 'https://evil.invalid'))).status, 403);
  assert.equal(writes, 0);
});
test('owner can disable protection without deleting its credential verifier', async () => {
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: false }, true))).status, 200);
  assert.equal(state.password_enabled, 'false');
  assert.equal(state.password_hash, TEST_HASH);
});
test('local first setup succeeds with a signed guest session', async () => {
  state.password_enabled = 'false'; state.password_hash = '';
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: true, password: 'synthetic-test-only' }))).status, 200);
  assert.equal(state.password_enabled, 'true');
  assert.match(state.password_hash, /^pbkdf2-sha256\$600000\$/);
});
test('production first setup is rejected', async () => {
  state.password_enabled = 'false'; state.password_hash = '';
  const saved = process.env.NODE_ENV; Reflect.set(process.env, 'NODE_ENV', 'production');
  try { assert.equal((await POST(await request('/api/auth/set-password', { enabled: true, password: 'synthetic-test-only' }, false, 'http://localhost:3000'))).status, 403); }
  finally { if (saved === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Reflect.set(process.env, 'NODE_ENV', saved); }
  assert.equal(writes, 0);
});
test('malformed enabled flag cannot accidentally disable protection', async () => {
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: 'false' }, true))).status, 400);
  assert.equal(writes, 0);
});
test('password change revokes previously verified sessions', async () => {
  const oldRequest = await request('/api/summary', undefined, true);
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: true, password: 'new-synthetic-test-only' }, true))).status, 200);
  assert.equal((await proxy(oldRequest)).status, 401);
});
test('valid login grants a session accepted by the proxy', async () => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-test-only'));
  state.password_hash = Buffer.from(hash).toString('hex');
  const response = await login(await request('/api/auth/verify-password', { password: 'synthetic-test-only' }));
  assert.equal((await response.json()).valid, true);
  const token = response.cookies.get('adimology_session')!.value;
  assert.equal((await proxy(new NextRequest('http://127.0.0.1:3000/api/summary', { headers: { cookie: `adimology_session=${token}` } }))).status, 200);
});
test('failed settings read cannot issue a guest session', async () => {
  delete state.password_enabled;
  const response = await checkPassword(new Request('http://127.0.0.1:3000/api/auth/check-password'));
  assert.equal(response.status, 503);
  assert.equal(response.cookies.get('adimology_session'), undefined);
});
test('failed settings read blocks protected API', async () => {
  const req = await request('/api/summary', undefined, true);
  delete state.password_enabled;
  assert.equal((await proxy(req)).status, 503);
});


test('short new password is rejected', async () => {
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: true, password: '1234' }, true))).status, 400);
  assert.equal(writes, 0);
});


test('new salted password can log in, wrong password cannot', async () => {
  state.password_enabled = 'false'; state.password_hash = '';
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: true, password: 'synthetic-test-only' }))).status, 200);
  const wrong = await login(await request('/api/auth/verify-password', { password: 'wrong-synthetic-value' }));
  assert.equal((await wrong.json()).valid, false);
  assert.equal(wrong.cookies.get('adimology_session'), undefined);
  const response = await login(await request('/api/auth/verify-password', { password: 'synthetic-test-only' }));
  assert.equal((await response.json()).valid, true);
  const token = response.cookies.get('adimology_session')!.value;
  const req = new NextRequest('http://127.0.0.1:3000/api/summary', { headers: { cookie: `adimology_session=${token}` } });
  assert.equal((await proxy(req)).status, 200);
});
test('new password hashes have random salts', async () => {
  const { hashPassword } = await import('../lib/password');
  assert.notEqual(await hashPassword('synthetic-test-only'), await hashPassword('synthetic-test-only'));
});
test('missing Origin is rejected even for an owner session', async () => {
  const req = await request('/api/auth/set-password', { enabled: false }, true);
  req.headers.delete('origin');
  assert.equal((await POST(req)).status, 403);
  assert.equal(writes, 0);
});
test('stale owner cannot change settings after a credential change', async () => {
  const stale = await request('/api/auth/set-password', { enabled: false }, true);
  state.password_hash = 'changed-hash';
  assert.equal((await POST(stale)).status, 403);
  assert.equal(writes, 0);
});
test('history row count remains writable through profile API', async () => {
  const response = await putProfile(await request('/api/profile', { key: 'history_row_count', value: 10 }, true));
  assert.equal(response.status, 200);
  assert.equal(state.history_row_count, '10');
});
test('appended token segments are rejected', async () => {
  const token = await auth.createSessionToken({ authenticated: true });
  assert.equal(await auth.verifySessionToken(token + '.extra'), null);
});


test('server requires current password even with a verified session', async () => {
  const response = await POST(await request('/api/auth/set-password', { enabled: false, currentPassword: null }, true));
  assert.equal(response.status, 403);
  assert.equal(writes, 0);
});


test('password hash and enabled flag are saved in one database statement', async () => {
  state.password_enabled = 'false'; state.password_hash = '';
  assert.equal((await POST(await request('/api/auth/set-password', { enabled: true, password: 'synthetic-test-only' }))).status, 200);
  assert.equal(writes, 1);
});


test('wrong current password cannot change protection', async () => {
  const response = await POST(await request('/api/auth/set-password', { enabled: false, currentPassword: 'wrong-synthetic-value' }, true));
  assert.equal(response.status, 403);
  assert.equal(writes, 0);
});
test('failed atomic save leaves authentication settings unchanged', async () => {
  state.password_enabled = 'false'; state.password_hash = '';
  failWrite = true;
  const response = await POST(await request('/api/auth/set-password', { enabled: true, password: 'synthetic-test-only' }));
  assert.equal(response.status, 503);
  assert.equal(state.password_enabled, 'false');
  assert.equal(state.password_hash, '');
});
