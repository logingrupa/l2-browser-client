import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { privatePreviewHostname, privatePreviewOrigin, privatePreviewWorldPath } from './private-preview-targets.mjs';

const execute = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(project, '.assets/private-preview');
const nginx = 'C:/laragon/bin/nginx/nginx-1.22.0/nginx.exe';
const config = path.join(directory, 'nginx.conf');
const pidFile = path.join(directory, 'nginx.pid');
const stateFile = path.join(directory, 'origin-state.json');
const ownerFile = path.join(directory, 'origin-owner.json');
const keyFile = path.join(directory, 'access-key');
const inviteFile = path.join(directory, 'private-invite.txt');
const dist = path.join(project, 'dist');
const cookieName = '__Host-l2_preview';
const hostname = privatePreviewHostname;
const port = 8189;
const slash = (value) => value.replaceAll('\\', '/');
const quotePs = (value) => `'${value.replaceAll("'", "''")}'`;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const owner = { version: 1, project, nginx, config, pidFile, port, hostname };

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function powershell(script) {
  const result = await execute('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';${script}`], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}
async function portAvailable() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}
async function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid owned process ID.');
  const output = await powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){[pscustomobject]@{pid=$p.ProcessId;executable=$p.ExecutablePath;command=$p.CommandLine;created=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`);
  return output ? JSON.parse(output) : null;
}
function matchingProcess(info) {
  if (!info?.command || !info.executable || slash(info.executable).toLowerCase() !== slash(nginx).toLowerCase()) return false;
  const args = [...info.command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
  return args.length === 5 && args[1] === '-p' && slash(args[2]) === `${slash(directory)}/` && args[3] === '-c' && slash(args[4]) === slash(config);
}
async function validateOwner() {
  if (JSON.stringify(await json(ownerFile)) !== JSON.stringify(owner)) throw Error('Unrecognized preview ownership record; refusing to manage this directory.');
}
async function initialize() {
  if (await exists(directory)) {
    await validateOwner();
  } else {
    await fs.mkdir(directory, { recursive: true });
    const sid = await powershell('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
    if (!/^S-1-5-\d+(?:-\d+)+$/.test(sid)) throw Error('Could not identify the Windows user.');
    await execute('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
    await fs.writeFile(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
  }
  const acl = JSON.parse(await powershell(`$a=Get-Acl -LiteralPath ${quotePs(directory)};$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;[pscustomobject]@{protected=$a.AreAccessRulesProtected;rules=@($a.Access|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;allow=($_.AccessControlType -eq 'Allow')}});user=$sid}|ConvertTo-Json -Depth 4 -Compress`));
  if (!acl.protected || acl.rules.length !== 2 || acl.rules.some((rule) => !rule.allow || ![acl.user, 'S-1-5-18'].includes(rule.sid))) throw Error('Private preview directory ACL is not restricted to this user and SYSTEM.');
  if (!await exists(keyFile)) {
    if (await exists(config) || await exists(inviteFile)) throw Error('Existing preview files have no key; refusing to replace the invite.');
    await fs.writeFile(keyFile, randomBytes(32).toString('hex'), { flag: 'wx' });
  }
  const key = (await fs.readFile(keyFile, 'utf8')).trim();
  if (!/^[0-9a-f]{64}$/.test(key)) throw Error('Invalid private preview key.');
  const invite = `${privatePreviewOrigin}/enter?key=${key}\n`;
  if (await exists(inviteFile)) {
    if (await fs.readFile(inviteFile, 'utf8') !== invite) throw Error('Private invite and key disagree.');
  } else await fs.writeFile(inviteFile, invite, { flag: 'wx' });
  await fs.mkdir(path.join(directory, 'temp'), { recursive: true });
  return key;
}
async function validateDist() {
  if (!await exists(path.join(dist, 'index.html'))) throw Error('Build dist/index.html before starting the private preview.');
  let files = 0;
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if ((await fs.lstat(full)).isSymbolicLink()) throw Error('The static build contains a link or junction; refusing to serve it.');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files++;
      else throw Error('The static build contains a non-file entry.');
    }
  }
  if ((await fs.lstat(dist)).isSymbolicLink()) throw Error('The static build root must not be a link or junction.');
  await walk(dist);
  return files;
}
function configuration(key) {
  const headers = `add_header Cache-Control "private, no-store" always;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;`;
  return `worker_processes 1;
pid "${slash(pidFile)}";
error_log "${slash(directory)}/origin-error.log" warn;
events { worker_connections 1024; }
http {
  include "${path.posix.dirname(nginx)}/conf/mime.types";
  default_type application/octet-stream;
  access_log off;
  server_tokens off;
  client_body_temp_path "${slash(directory)}/temp";
  map $http_cookie $preview_cookie_ok { default 0; "~(?:^|;[ ]*)${cookieName}=${key}(?:;|$)" 1; }
  map $arg_key $preview_key_ok { default 0; ~^${key}$ 1; }
  map "$preview_key_ok:$request_method" $preview_set_cookie {
    default "";
    "1:GET" "${cookieName}=${key}; Path=/; Secure; HttpOnly; SameSite=Lax";
    "1:HEAD" "${cookieName}=${key}; Path=/; Secure; HttpOnly; SameSite=Lax";
  }
  map "$preview_cookie_ok:$preview_key_ok:$uri" $preview_allowed {
    default 0;
    ~^1: 1;
    "0:1:/enter" 1;
  }
  server {
    listen 127.0.0.1:${port} default_server backlog=1024;
    server_name ${hostname};
    root "${slash(dist)}";
    index index.html;
    autoindex off;
    absolute_redirect off;
    if ($request_method !~ ^(GET|HEAD)$) { return 403; }
    if ($preview_allowed = 0) { return 403; }
    ${headers}
    location = /enter {
      if ($preview_key_ok = 0) { return 403; }
      add_header Set-Cookie $preview_set_cookie always;
      ${headers}
      return 303 "${privatePreviewWorldPath}";
    }
    location ~ (^|/)\\. { return 404; }
    location ~* \\.(map|ts|tsx|jsx|mjs|cjs)$ { return 404; }
    location / { try_files $uri $uri/ =404; }
  }
}
`;
}
async function ownedState() {
  await validateOwner();
  if (!await exists(stateFile)) {
    if (await exists(pidFile) || !await portAvailable()) throw Error('Unrecognized process or listener; refusing to manage it.');
    return null;
  }
  const state = await json(stateFile);
  const info = await processInfo(state.pid);
  if (!info) {
    if (!await portAvailable()) throw Error('Recorded process exited but the preview port is occupied by another process.');
    return null;
  }
  if (!matchingProcess(info) || info.created !== state.created) throw Error('Recorded PID belongs to another process; refusing to manage it.');
  const recordedPid = Number((await fs.readFile(pidFile, 'utf8')).trim());
  if (recordedPid !== state.pid) throw Error('Preview PID file and ownership state disagree.');
  if (digest(await fs.readFile(config)) !== state.configSha256) throw Error('Preview config changed outside its owner; refusing to manage it.');
  return state;
}
async function nginxCommand(args) {
  try { await execute(nginx, ['-p', `${slash(directory)}/`, '-c', slash(config), ...args], { windowsHide: true }); }
  catch { throw Error('Private nginx command failed; diagnostic output suppressed because the config contains a private key.'); }
}
async function anonymousStatus() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 3000 }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.on('timeout', () => request.destroy(Error('Origin probe timed out.')));
  });
}
async function start() {
  if (await exists(directory)) {
    const existing = await ownedState();
    if (existing) { await initialize(); return { status: 'running', pid: existing.pid, port, inviteFile }; }
  }
  if (!await portAvailable()) throw Error('Port 8189 is occupied; no existing process was changed.');
  const files = await validateDist();
  const key = await initialize();
  await fs.writeFile(config, configuration(key), 'utf8');
  if (await exists(pidFile)) await fs.unlink(pidFile);
  if (await exists(stateFile)) await fs.unlink(stateFile);
  await nginxCommand(['-t', '-q']);
  const child = spawn(nginx, ['-p', `${slash(directory)}/`, '-c', slash(config)], { windowsHide: true, detached: true, stdio: 'ignore' });
  let spawnError = false;
  child.on('error', () => { spawnError = true; });
  child.unref();
  let state;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (spawnError) throw Error('Could not start the private nginx process.');
    if (await exists(pidFile)) {
      const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
      if (!Number.isSafeInteger(pid) || pid < 1) { await sleep(100); continue; }
      const info = await processInfo(pid);
      if (!info) { await sleep(100); continue; }
      if (!matchingProcess(info)) throw Error('Started process did not match the private preview identity.');
      state = { pid, created: info.created, configSha256: digest(await fs.readFile(config)), distIndexSha256: digest(await fs.readFile(path.join(dist, 'index.html'))), files };
      await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
      break;
    }
    await sleep(100);
  }
  if (!state) throw Error('Private nginx did not publish its owned PID.');
  if (await anonymousStatus() !== 403) { await stop(); throw Error('Anonymous gate check failed; private origin stopped.'); }
  return { status: 'running', pid: state.pid, port, files, inviteFile };
}
async function stop() {
  if (!await exists(directory)) return { status: 'stopped', port };
  const state = await ownedState();
  if (!state) return { status: 'stopped', port };
  await nginxCommand(['-s', 'quit']);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!await processInfo(state.pid) && await portAvailable()) {
      await fs.unlink(stateFile);
      return { status: 'stopped', port };
    }
    await sleep(100);
  }
  throw Error('Owned nginx is still shutting down; no other process was terminated.');
}

try {
  if (process.platform !== 'win32') throw Error('Private preview currently supports this Windows nginx installation only.');
  const command = process.argv[2];
  if (!['start', 'stop', 'status'].includes(command) || process.argv.length !== 3) throw Error('Usage: pnpm preview:private start|stop|status');
  let result;
  if (command === 'start') result = await start();
  else if (command === 'stop') result = await stop();
  else {
    const state = await exists(directory) ? await ownedState() : null;
    result = { status: state ? 'running' : 'stopped', port, ...(state ? { pid: state.pid, anonymousStatus: await anonymousStatus(), inviteFile } : {}) };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Private preview failed.');
  process.exitCode = 1;
}
