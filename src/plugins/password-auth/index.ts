import { LoginAttemptLimiter } from './login-attempt-limiter';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import onHeaders from 'on-headers';
import { KnowledgeBasePlugin } from '../../core/plugins';
import { PasswordAuthOptions, resolveConfig, SESSION_SECONDS } from './config';
import { verifyPassword } from './password-service';
import {
  createToken,
  verifyToken,
  csrfToken,
  safeEqual,
} from './token-service';
import { loginPage } from './ui/login-page';
export { PasswordAuthOptions } from './config';

export function passwordAuthPlugin(
  options: PasswordAuthOptions = {}
): KnowledgeBasePlugin {
  const config = resolveConfig(options);
  const router = express.Router({ caseSensitive: true, strict: true });
  // Public failures deliberately omit the internal rejection reason.
  const fail = (res: Response, status: number) =>
    res
      .status(status)
      .json({ error: { message: 'Не вдалося виконати запит.' } });
  const sameOrigin = (req: Request) => req.get('origin') === config.origin;
  // Reject duplicate cookies instead of letting parser order choose a credential.
  const session = (req: Request) => {
    const cookies = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(config.cookieName + '='));
    return cookies.length === 1
      ? verifyToken(config, cookies[0].slice(config.cookieName.length + 1))
      : null;
  };
  const cookie = (res: Response, token: string, maxAge: number) =>
    res.cookie(config.cookieName, token, {
      httpOnly: true,
      secure: config.secure,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  router.use((req, res, next) => {
    // Static/search handlers may set their own caching policy later in the chain.
    // Apply private headers at the last moment so they cannot accidentally override it.
    onHeaders(res, function () {
      this.setHeader('Cache-Control', 'private, no-store');
      this.setHeader('Pragma', 'no-cache');
      this.removeHeader('ETag');
      this.removeHeader('Last-Modified');
      // Do not disclose the server implementation on the public login surface.
      this.removeHeader('X-Powered-By');
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.get('host') !== config.host) {
      fail(res, 400);
      return;
    }
    // Conditional requests must not restore previously cached private responses.
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    next();
  });
  router.get('/login', (_req, res) => {
    const nonce = crypto.randomBytes(18).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
    );
    res.type('html').send(loginPage(nonce));
  });
  // Shared across callers of this plugin instance; forwarded IP cannot bypass it.
  // A restart starts empty. Multiple instances still have independent buckets.
  const attempts = new LoginAttemptLimiter();
  let verifying = false;
  router.post(
    '/auth/login',
    (req, res, next) => {
      if (!sameOrigin(req)) {
        fail(res, 403);
        return;
      }
      if (!req.is('application/json')) {
        fail(res, 400);
        return;
      }
      const retryAfter = verifying ? 1 : attempts.consume();
      if (retryAfter > 0) {
        res.setHeader('Retry-After', String(retryAfter));
        fail(res, 429);
        return;
      }
      next();
    },
    express.json({ limit: '2kb', strict: true }),
    async (req, res) => {
      const body = req.body;
      if (
        !body ||
        typeof body.password !== 'string' ||
        Object.keys(body).length !== 1 ||
        Buffer.byteLength(body.password) < 1 ||
        Buffer.byteLength(body.password) > 1024
      ) {
        fail(res, 400);
        return;
      }
      if (verifying) {
        res.setHeader('Retry-After', '1');
        fail(res, 429);
        return;
      }
      verifying = true;
      try {
        if (!(await verifyPassword(config.passwordHash, body.password))) {
          fail(res, 401);
          return;
        }
        cookie(res, createToken(config), SESSION_SECONDS * 1000);
        res.status(204).end();
      } catch {
        fail(res, 503);
      } finally {
        verifying = false;
      }
    }
  );
  router.use(
    (
      err: { status?: number },
      _req: Request,
      res: Response,
      next: NextFunction
    ) => {
      if (!err) {
        next();
        return;
      }
      fail(res, err.status === 413 ? 413 : 400);
    }
  );
  // Stateless logout clears this browser only; version/key rotation revokes copies.
  router.post('/logout', (req, res) => {
    const claims = session(req);
    if (
      !sameOrigin(req) ||
      (claims &&
        !safeEqual(req.get('x-csrf-token') || '', csrfToken(config, claims)))
    ) {
      fail(res, 403);
      return;
    }
    cookie(res, '', 0);
    res.status(204).end();
  });
  // Everything below the public auth endpoints requires a validated session.
  router.use((req, res, next) => {
    const claims = session(req);
    if (!claims) {
      if (
        req.method === 'GET' &&
        req.get('accept')?.includes('text/html') &&
        !req.path.startsWith('/api/') &&
        !req.path.startsWith('/auth/')
      ) {
        res.redirect(303, '/login');
        return;
      }
      fail(res, 401);
      return;
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (!sameOrigin(req) ||
        !safeEqual(req.get('x-csrf-token') || '', csrfToken(config, claims)))
    ) {
      fail(res, 403);
      return;
    }
    res.locals.authentication = {
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
    if (req.path === '/auth/session' && ['GET', 'HEAD'].includes(req.method)) {
      res.json({
        ...res.locals.authentication,
        csrfToken: csrfToken(config, claims),
      });
      return;
    }
    next();
  });
  return { id: 'password-auth', authentication: { middleware: router } };
}
