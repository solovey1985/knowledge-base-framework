# Password authentication plugin

`passwordAuth` is an optional server plugin, independent of storage and Work Manager. This implementation is in the working tree and has not been published to npm. Requires Node.js 20.19+, 22.13+, or 24+ (see package engines).

## Enable

Current configuration in `kb.plugins.json`:

```json
{
  "plugins": [
    { "name": "passwordAuth", "enabled": true, "options": { "sessionTtlDays": 14 } }
  ]
}
```

Set server environment variables (never put their values in content or plugin JSON):

| Variable | Value |
| --- | --- |
| AUTH_PASSWORD_HASH | Argon2id PHC hash; generate with exported `hashPassword(password)` |
| AUTH_SIGNING_SECRET | At least 32 cryptographically random bytes, base64url encoded |
| AUTH_SESSION_VERSION | Nonempty revision, e.g. `1`; change when changing the password |
| AUTH_SITE_ID | Unique nonempty installation ID |
| AUTH_ORIGIN | Exact HTTPS origin, no path or trailing slash |

The corresponding `PasswordAuthOptions` fields `passwordHashEnv`, `signingSecretEnv`, `sessionVersionEnv`, `siteIdEnv`, `originEnv` rename environment variable references. Missing/invalid configuration stops startup. `enabled: false` skips configuration entirely. `.env` is not automatically loaded.

The hash helper requires 12–1024 UTF-8 bytes and uses Argon2id, 19 MiB, two iterations, one lane, random salt. Supply the password in memory from a secure prompt or secret manager, not a literal in shell history. For a signing key use `crypto.randomBytes(32).toString('base64url')` and save it in the server secret configuration. Never generate a new signing key on each startup. [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Local HTTP testing explicitly requires `allowInsecureLocalhost: true` and an origin using localhost, 127.0.0.1 or ::1. It cannot permit HTTP for a remote hostname. Use HTTPS for deployments; the reverse proxy must redirect public HTTP to HTTPS.

## Server lifecycle

```javascript
const plugins = loadPluginsFromFile('./kb.plugins.json');
const kb = new KnowledgeBase({ contentRootPath: './content', plugins });
kb.setupSecurity(app); // BEFORE any app/static/API routes
app.use('/assets', express.static('./assets'));
kb.setupMiddleware(app);
```

`KnowledgeBasePlugin.authentication.middleware` runs before `setupServer` routes and content; at most one provider is allowed. `setupSecurity` is idempotent for an Express app. CLI and generated server scaffolds use this order. Applications registering routes before this call remain responsible for those earlier routes.

Without the plugin, ordinary framework sites remain public. Enabled legacy `auth` or `KB_AUTH_ENABLED=true` is rejected with migration instructions; old cookies are never accepted. Static builders reject authentication plugins before writing output. Static hosting cannot execute this protection, and existing public copies must be removed or protected separately by the operator.

## HTTP contract

| Request | Response |
| --- | --- |
| GET /login | Public self-contained login/session page; nonce CSP, no external assets |
| POST /auth/login | Exact Origin, JSON `{ "password": "..." }`; 204 + cookie, 400 invalid body, 401 wrong password, 413 too large, 429 rate limit, 503 hash verification unavailable |
| GET /auth/session | 200 `{ "expiresAt": "ISO timestamp", "csrfToken": "..." }` or JSON 401 |
| POST /logout | Exact Origin and session CSRF when signed in; 204 clears cookie; invalid CSRF 403 |
| Other routes | Require cookie; unsafe methods additionally require Origin and X-CSRF-Token |

Host must match configured origin. No forwarded IP header is trusted for authentication or rate limiting. Anonymous HTML navigation redirects 303 to `/login`; API requests return JSON 401. Errors use `{ "error": { "message": "Не вдалося виконати запит." } }`. Login intentionally returns to `/`, with no untrusted redirect target.

JWT HS256 uses a pinned algorithm and validates signature, issuer, audience, issued/expiry times, UUID and session version. `exp - iat = 1209600` seconds; no sliding extension. Cookies: `__Host-kb_session`, HttpOnly, Secure, SameSite=Strict, Path=/, Max-Age=1209600, no Domain. Local HTTP uses `kb_session_dev`. CSRF is a domain-separated HMAC bound to site and token UUID, and survives restarts.

Logout does not revoke copied stateless tokens. Rotate the version or signing key across all instances to revoke all sessions. Update version whenever changing the password. Private responses force `private, no-store`, including static files and search responses; conditional cache headers are removed.

## Validation and deployment gates

- `npm test`: build + twelve auth test groups, HTTP endpoints, cookies, raw/encoded/HEAD/Range guards, CSRF, separate-process token verification, CLI guard and disabled-plugin regression.
- `npm run lint`.
- Second Brain browser flow tested with temporary local credentials: wrong password, keyboard submit, successful login, session expiry display, logout, protected navigation after logout. This is not Render acceptance.
- Single-process login bucket: initially empty, one attempt per 10 seconds, capacity three. Rejected requests return 429 with the remaining whole-second Retry-After; the page shows only a neutral retry message. Existing sessions are unaffected. One password verification can run at a time.
- Restart discards credit rather than granting fresh attempts. Monotonic time prevents clock corrections from adding credit. Tests cover cold start, refill boundaries, idle cap, backwards clock, restart, spoofed IP and active sessions during throttling.
- This is the accepted first approach, without external Redis. The bucket is shared by all callers; an attacker can consume the available attempts. Multiple replicas/overlapping deployments have independent buckets. This is not a distributed limit; keep a single process and revisit before scaling.
- Dependency audit after the security update: `npm audit` and `npm audit --omit=dev` report zero findings in framework. Unused glob/chokidar/Jest packages were removed. ESLint 10 and typescript-eslint use a flat config; a minimatch 11.0.4 override addresses the transitive globparts advisory. Build, lint and auth tests validate the upgraded tree.
- Framework version 2.0.0-rc.3 is a local release candidate, not published to npm. Second Brain pins its checked-in vendor tarball with package-lock integrity so npm ci retains the auth implementation.

Source: `src/plugins/password-auth/`; integration: `src/core/plugins.ts`, `KnowledgeBase.setupSecurity`, `src/plugins/pluginSettings.ts`. Storage and Work Manager are not implemented by this plugin.

The anonymous login page has no product name, description or session lifetime. Its title is simply Login (localized). X-Powered-By is removed; functional form labels and generic errors remain. This reduces disclosure but is not a substitute for authentication or a guarantee against fingerprinting.

All authentication rejection bodies and UI failures use the same neutral message, without internal reason codes. HTTP statuses and Retry-After retain protocol semantics; failures are not claimed to be indistinguishable at the network or timing level.
