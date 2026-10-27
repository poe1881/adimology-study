// Web Crypto keeps this helper usable by Next.js without native dependencies.
const ITERATIONS = 600_000;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], b => parseInt(b, 16));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${hex(salt)}$${hex(await derive(password, salt))}`;
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

export async function verifyPassword(password: string, stored: string) {
  if (/^[a-f0-9]{64}$/.test(stored)) {
    // Compatibility for pre-existing installs; newly set passwords always use PBKDF2.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return equal(hex(new Uint8Array(digest)), stored);
  }
  const match = /^pbkdf2-sha256\$600000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored);
  if (!match) return false;
  return equal(hex(await derive(password, unhex(match[1]))), match[2]);
}
