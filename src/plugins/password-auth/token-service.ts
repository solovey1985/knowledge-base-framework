import crypto from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AuthConfig, SESSION_SECONDS } from './config';
export interface SessionClaims extends JwtPayload {
  iat: number;
  exp: number;
  jti: string;
  sessionVersion: string;
}
export function createToken(config: AuthConfig): string {
  return jwt.sign({ sessionVersion: config.version }, config.secret, {
    algorithm: 'HS256',
    issuer: config.siteId,
    audience: config.siteId,
    expiresIn: SESSION_SECONDS,
    jwtid: crypto.randomUUID(),
  });
}
export function verifyToken(
  config: AuthConfig,
  token: string
): SessionClaims | null {
  try {
    if (token.length > 4096) {
      return null;
    }
    const claims = jwt.verify(token, config.secret, {
      algorithms: ['HS256'],
      issuer: config.siteId,
      audience: config.siteId,
    }) as SessionClaims;
    // Accept only our fixed-lifetime sessions, even when another signed JWT is supplied.
    if (
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) ||
      claims.exp - claims.iat !== SESSION_SECONDS ||
      claims.iat > Math.floor(Date.now() / 1000) ||
      typeof claims.jti !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(claims.jti) ||
      claims.sessionVersion !== config.version
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
// Domain separation keeps this MAC distinct from JWT signatures using the same key.
export function csrfToken(config: AuthConfig, claims: SessionClaims): string {
  return crypto
    .createHmac('sha256', config.secret)
    .update(JSON.stringify(['kb-csrf-v1', config.siteId, claims.jti]))
    .digest('base64url');
}
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
