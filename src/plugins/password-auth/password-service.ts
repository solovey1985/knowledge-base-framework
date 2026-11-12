import argon2 from 'argon2';
export function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('Use a password or passphrase of 12–1024 UTF-8 bytes.');
  }
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}
export function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}
