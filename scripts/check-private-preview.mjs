import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = path.join(project, '.assets/private-preview');
const helper = path.join(project, 'scripts/private-preview.mjs');
const evidence = path.join(project, 'artifacts/private-preview/local-gate.json');
const key = (await fs.readFile(path.join(privateDir, 'access-key'), 'utf8')).trim();
const cookie = `__Host-l2_preview=${key}`;
const checks = [];
function assert(condition, name) {
  if (!condition) throw Error(`Private preview check failed: ${name}`);
  checks.push({ name, passed: true });
}
function request(target, { method = 'GET', authenticated = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 8189, path: target, method, headers: { ...(authenticated ? { Cookie: cookie } : {}), ...headers }, timeout: 5000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', () => reject(Error('Private preview HTTP request failed.')));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}
async function command(action) {
  const result = await execute(process.execPath, [helper, action], { windowsHide: true });
  return JSON.parse(result.stdout);
}
try {
  const index = await fs.readFile(path.join(project, 'dist/index.html'));
  const asset = index.toString('utf8').match(/src="(\/assets\/[^"?]+\.js)"/)?.[1];
  assert(Boolean(asset), 'Production JavaScript asset found');
  for (const target of ['/', '/?authored=1', asset, '/scene/native-world.babylon', '/l2/catalog.json']) {
    const response = await request(target);
    assert(response.status === 403 && !response.headers['set-cookie'], `Anonymous resource denied: ${target}`);
  }
  for (const headers of [{ Cookie: '__Host-l2_preview=wrong' }, { Cookie: `${cookie}suffix` }, { Cookie: `prefix${cookie}` }]) {
    const response = await request('/', { headers });
    assert(response.status === 403 && !response.headers['set-cookie'], 'Wrong cookie denied');
  }
  for (const target of ['/enter', '/enter?key=wrong', `/?key=${key}`]) {
    const response = await request(target);
    assert(response.status === 403 && !response.headers['set-cookie'], 'Missing, wrong, or misplaced invite denied');
  }
  const invitation = await request(`/enter?key=${key}`);
  const cookies = invitation.headers['set-cookie'] ?? [];
  assert(invitation.status === 303 && invitation.headers.location === '/?authored=1', 'Valid invite redirects to authored native world');
  assert(cookies.length === 1 && cookies[0] === `${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`, 'Invite issues only the scoped secure HttpOnly session cookie');
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']) {
    const response = await request(`/enter?key=${key}`, { method, authenticated: true });
    assert([403, 405].includes(response.status) && !response.headers['set-cookie'], `Method ${method} denied without issuing a cookie`);
  }
  const page = await request('/?authored=1', { authenticated: true });
  assert(page.status === 200 && page.body.equals(index), 'Authenticated page exactly matches built dist');
  const javascript = await request(asset, { authenticated: true });
  assert(javascript.status === 200 && javascript.body.equals(await fs.readFile(path.join(project, 'dist', asset))), 'Authenticated asset exactly matches built dist');
  const head = await request(asset, { authenticated: true, method: 'HEAD' });
  assert(head.status === 200 && head.body.length === 0, 'Authenticated HEAD works without a body');
  for (const response of [page, invitation, await request('/')]) {
    assert(response.headers['cache-control'] === 'private, no-store' && response.headers['referrer-policy'] === 'no-referrer' && response.headers['x-robots-tag'] === 'noindex, nofollow, noarchive' && response.headers['x-content-type-options'] === 'nosniff', 'Private no-store, noindex, referrer, and MIME headers present');
  }
  for (const target of ['/src/main.ts', '/@vite/client', '/package.json', '/.assets/private-preview/access-key', '/../package.json', '/%2e%2e/package.json', '/assets/', '/assets/absent.js.map']) {
    const response = await request(target, { authenticated: true });
    assert([400, 403, 404].includes(response.status), `Source, traversal, or listing unavailable: ${target}`);
  }
  const beforeState = await command('status');
  assert(beforeState.status === 'running' && beforeState.anonymousStatus === 403, 'Owned status confirms closed anonymous gate');
  assert((await command('start')).pid === beforeState.pid, 'Repeated start preserves the owned instance');
  assert((await command('stop')).status === 'stopped', 'Controlled stop succeeds');
  const sentinel = net.createServer((socket) => socket.end());
  await new Promise((resolve, reject) => { sentinel.once('error', reject); sentinel.listen(8189, '127.0.0.1', resolve); });
  let refused = false;
  try { await command('start'); } catch { refused = true; }
  assert(refused && sentinel.listening, 'Occupied port is refused without stopping its owner');
  await new Promise((resolve) => sentinel.close(resolve));
  const restarted = await command('start');
  assert(restarted.status === 'running' && restarted.pid !== beforeState.pid, 'Controlled restart creates a new owned process');
  assert((await fs.readFile(path.join(privateDir, 'access-key'), 'utf8')).trim() === key, 'Restart preserves the original invite key');
  assert((await request('/', { authenticated: true })).status === 200 && (await request('/')).status === 403, 'Restart preserves authenticated access and anonymous denial');
  const snapshot = JSON.parse(await fs.readFile(path.join(project, 'artifacts/private-preview/before.json'), 'utf8'));
  for (const file of snapshot.sourceFiles) {
    const hash = createHash('sha256').update(await fs.readFile(path.join(project, file.path))).digest('hex');
    assert(hash === file.sha256, `Preserved source: ${file.path}`);
  }
  await fs.writeFile(evidence, `${JSON.stringify({ verifiedAtUtc: new Date().toISOString(), passed: checks.length, checks, finalStatus: 'running', port: 8189, privateInviteFile: path.join(privateDir, 'private-invite.txt') }, null, 2)}\n`);
  console.log(JSON.stringify({ passed: checks.length, finalStatus: 'running', port: 8189, evidence }, null, 2));
} catch (error) {
  const isKeyFreeFailureMessage = error instanceof Error && error.message.startsWith('Private preview');
  console.error(isKeyFreeFailureMessage ? error.message : 'Private preview verification failed; sensitive diagnostics suppressed.');
  process.exitCode = 1;
}
