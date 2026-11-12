import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OAuth2Client } from 'google-auth-library';

export const redirectUri = 'http://127.0.0.1:8765/oauth/callback';
export const scope = 'https://www.googleapis.com/auth/drive.file';

export function validateClient(document) {
  const client = document.web;
  if (!client?.client_id || !client?.client_secret ||
      !client.redirect_uris?.includes(redirectUri)) {
    throw new Error('Expected a Web OAuth client with the documented loopback callback.');
  }
  return client;
}

export function validState(actual, expected) {
  if (typeof actual !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function main(clientPath, outputPath) {
  if (!clientPath || !outputPath) {
    throw new Error('Usage: node scripts/setup-google-drive.mjs <client.json> <private-output.json>');
  }
  const client = validateClient(JSON.parse(await readFile(clientPath, 'utf8')));
  // Reserve the output before consent: never overwrite an existing credential.
  // On Windows the operator must restrict the parent directory ACL first.
  const output = await open(outputPath, 'wx', 0o600);
  const oauth = new OAuth2Client(client.client_id, client.client_secret, redirectUri);
  const state = randomBytes(32).toString('base64url');
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: 'offline', prompt: 'consent', scope: [scope], state,
    code_challenge: codeChallenge, code_challenge_method: 'S256',
    include_granted_scopes: false,
  });
  let consumed = false;
  let timer;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:8765') {
      response.writeHead(400).end('Invalid request.');
      return;
    }
    const url = new URL(request.url, redirectUri);
    if (url.pathname === '/start' && !consumed) {
      response.writeHead(302, { Location: authorizationUrl }).end();
      return;
    }
    if (url.pathname !== '/oauth/callback' || consumed ||
        url.searchParams.getAll('state').length !== 1 ||
        !validState(url.searchParams.get('state'), state)) {
      response.writeHead(400).end('Invalid request.');
      return;
    }
    consumed = true;
    clearTimeout(timer);
    try {
      if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1) {
        throw new Error('Consent not completed.');
      }
      const { tokens } = await oauth.getToken({
        code: url.searchParams.get('code'), codeVerifier, redirect_uri: redirectUri,
      });
      if (!tokens.refresh_token || !tokens.access_token) throw new Error('Missing tokens.');
      const info = await oauth.getTokenInfo(tokens.access_token);
      if (!info.scopes.includes(scope) || info.scopes.some(value => value !== scope)) {
        throw new Error('Unexpected scope grant.');
      }
      // Keep the long-lived credential only; access tokens are generated on demand.
      await output.writeFile(JSON.stringify({
        client_id: client.client_id, client_secret: client.client_secret,
        refresh_token: tokens.refresh_token, scope,
      }, null, 2) + '\n');
      await output.sync();
      response.end('Google Drive connected. You may close this tab.');
      console.log('OAuth completed. Credentials saved to the private output file.');
    } catch {
      // SDK errors may contain tokens or authorization codes: never print them.
      process.exitCode = 1;
      response.writeHead(400).end('Setup failed. Close this tab and retry setup.');
      console.error('OAuth setup failed; no error details are logged to protect credentials.');
    } finally {
      await output.close();
      server.close();
    }
  });
  server.requestTimeout = 15_000;
  server.on('error', async () => {
    clearTimeout(timer);
    await output.close();
    console.error('Cannot start the local callback listener.');
    process.exitCode = 1;
  });
  timer = setTimeout(async () => {
    await output.close();
    server.close();
    console.error('Setup expired. Start a new attempt with a new output filename.');
    process.exitCode = 1;
  }, 15 * 60 * 1000);
  server.listen(8765, '127.0.0.1', () => {
    console.log('Open http://127.0.0.1:8765/start to connect your Google Drive (15 minute window).');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2], process.argv[3]).catch(() => {
    console.error('Setup could not start. Check credentials, callback and private output path.');
    process.exitCode = 1;
  });
}
