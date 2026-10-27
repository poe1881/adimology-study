# Local authentication hardening

## Scope

These changes protect password-management routes and session checks. They do not secure direct Supabase Data API access. Database RLS/grants, dependency vulnerabilities, distributed login throttling, Netlify function authorization and AI-provider migration remain separate work. Do not expose this app to the internet or add real Stockbit credentials yet.

## Password lifecycle

- Set `AUTH_SECRET` to a random secret of at least 32 characters. There is no known fallback.
- First password setup requires a signed guest session from `/api/auth/check-password`, a same-origin request, a loopback hostname and non-production mode. Enable a password through the local development UI before considering production deployment. Initial setup is refused in production.
- New passwords must be 12–1024 characters and use PBKDF2-HMAC-SHA256, 600,000 iterations and a random 16-byte salt. Existing SHA256 credentials can still log in for compatibility; change the password to replace a legacy hash.
- Once a credential exists, changes require a password-verified session bound to that credential. The settings modal asks for the current password before saving, and the server independently verifies it for every change. Both authentication settings are persisted in one database statement.
- Changing a password invalidates older verified sessions on subsequent protected API requests.
- Disabling the gate is an explicit public-access mode. The verifier is retained so changing/re-enabling protection still requires owner authentication. Disabling does not make the app safe to expose publicly.
- Missing/inconsistent database authentication settings fail closed.
- `/api/profile` only exposes `history_row_count`. Password settings cannot be read or overwritten through that route.
- Cron credentials are not administrator sessions and only bypass the proxy on the two explicitly listed job routes.

## Verification

Run from the repository root:

```bash
npm run test:auth
npx tsc --noEmit
npm run build
```

The regression suite uses synthetic credentials and a mocked Supabase persistence boundary. It never loads `.env.local` or writes to a live database. The initial regression was observed failing against the original route: an unauthenticated disable request returned HTTP 200 instead of 401. Similar regressions demonstrated the generic profile bypass and guest-session proxy bypass before fixes.

For local HTTP checks, only send unauthenticated rejected changes; do not set or reset a real password automatically. The owner should enter their password themselves in the app.

## Rollback

Changes are local to `study/local-testing`, with no GitHub push. Use `git diff` to review tracked edits. Preserve work before restoring files; new helper/test files are untracked until deliberately staged. Do not reset or clean unrelated work.
