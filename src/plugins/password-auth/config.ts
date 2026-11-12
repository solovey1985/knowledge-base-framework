export const SESSION_SECONDS = 14 * 24 * 60 * 60;
export interface PasswordAuthOptions {
  passwordHashEnv?: string;
  signingSecretEnv?: string;
  sessionVersionEnv?: string;
  siteIdEnv?: string;
  originEnv?: string;
  sessionTtlDays?: number;
  allowInsecureLocalhost?: boolean;
}
export interface AuthConfig {
  passwordHash: string;
  secret: Buffer;
  version: string;
  siteId: string;
  origin: string;
  host: string;
  secure: boolean;
  cookieName: string;
}
export function resolveConfig(options: PasswordAuthOptions): AuthConfig {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`passwordAuth: missing ${name}`);
    }
    return value;
  };
  if (options.sessionTtlDays !== undefined && options.sessionTtlDays !== 14) {
    throw new Error('passwordAuth: sessionTtlDays must be 14');
  }
  const passwordHash = env(options.passwordHashEnv || 'AUTH_PASSWORD_HASH');
  const match =
    /^\$argon2id\$v=19\$([^$]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      passwordHash
    );
  // PHC parameter order can differ between library versions. Validate by name.
  const parameters = match?.[1].split(',') || [];
  const costs = Object.fromEntries(parameters.map((part) => part.split('=')));
  if (
    !match ||
    parameters.length !== 3 ||
    Object.keys(costs).sort().join(',') !== 'm,p,t' ||
    parameters.some((part) => !/^[mpt]=[0-9]+$/.test(part)) ||
    +costs.m < 19456 ||
    +costs.m > 262144 ||
    +costs.t < 2 ||
    +costs.t > 10 ||
    +costs.p < 1 ||
    +costs.p > 8 ||
    Buffer.from(match[2], 'base64').length < 16 ||
    Buffer.from(match[3], 'base64').length !== 32
  ) {
    throw new Error(
      'passwordAuth: invalid Argon2id hash or unsupported cost parameters'
    );
  }
  // A separate persistent signing key prevents restarts from invalidating sessions.
  const secretText = env(options.signingSecretEnv || 'AUTH_SIGNING_SECRET');
  const secret = Buffer.from(secretText, 'base64url');
  if (
    !/^[A-Za-z0-9_-]+$/.test(secretText) ||
    secret.length < 32 ||
    secret.toString('base64url') !== secretText
  ) {
    throw new Error(
      'passwordAuth: signing secret must be at least 32 random bytes encoded as base64url'
    );
  }
  const version = env(options.sessionVersionEnv || 'AUTH_SESSION_VERSION');
  const siteId = env(options.siteIdEnv || 'AUTH_SITE_ID');
  if (version.length > 128 || siteId.length > 256) {
    throw new Error('passwordAuth: version/site ID too long');
  }
  const originText = env(options.originEnv || 'AUTH_ORIGIN');
  const origin = new URL(originText);
  if (origin.origin !== originText) {
    throw new Error(
      'passwordAuth: AUTH_ORIGIN must be a canonical origin without a trailing slash'
    );
  }
  const secure = origin.protocol === 'https:';
  if (
    !secure &&
    !(
      options.allowInsecureLocalhost === true &&
      origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    )
  ) {
    throw new Error(
      'passwordAuth: HTTPS required (explicit localhost exception only)'
    );
  }
  return {
    passwordHash,
    secret,
    version,
    siteId,
    origin: origin.origin,
    host: origin.host,
    secure,
    cookieName: secure ? '__Host-kb_session' : 'kb_session_dev',
  };
}
