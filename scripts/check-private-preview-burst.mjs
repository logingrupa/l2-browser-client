import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { nativeSectionResourcePaths, privatePreviewCatalogPath } from './private-preview-targets.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '..');
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw Error('--output-dir requires a path.');
const evidence = outputIndex >= 0 ? path.resolve(root, process.argv[outputIndex + 1]) : directory;
if (!evidence.startsWith(path.join(root, 'artifacts/private-preview') + path.sep)) throw Error('Evidence must stay under artifacts/private-preview.');
await fs.mkdir(evidence, { recursive: true });
try {
  await fs.access(path.join(evidence, 'report.json'));
  throw Error('Evidence already exists; use a new --output-dir.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const privateDirectory = path.join(root, '.assets/private-preview');
const key = (await fs.readFile(path.join(privateDirectory, 'access-key'), 'utf8')).trim();
if (!/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid private access key; value suppressed.');
const sanitize = value => String(value).replaceAll(key, '[private]').replace(/\/enter\?[^\s"']*/g, '/enter?[private]');
const distDirectory = path.join(root, 'dist');
const readDistFile = urlPath => fs.readFile(path.join(distDirectory, `.${urlPath}`));
const catalogBytes = await readDistFile(privatePreviewCatalogPath);
const catalog = JSON.parse(catalogBytes);
if (!Array.isArray(catalog.sections) || catalog.sections.length === 0) throw Error('The built native catalog lists no sections.');
const sectionResourcePaths = await Promise.all(catalog.sections.map(async sectionRecord =>
  nativeSectionResourcePaths(sectionRecord, JSON.parse(await readDistFile(sectionRecord.manifest)))));
const paths = [...new Set([privatePreviewCatalogPath, ...sectionResourcePaths.flat()])];
const concurrencyIndex = process.argv.indexOf('--concurrency');
const requestedConcurrency = concurrencyIndex >= 0 ? Number(process.argv[concurrencyIndex + 1]) : null;
if (concurrencyIndex >= 0 && (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > paths.length)) throw Error('--concurrency must be an integer within the resource count.');
const waves = requestedConcurrency === null ? [64, 256, paths.length] : [requestedConcurrency];
for (const resource of paths) {
  const local = path.resolve(distDirectory, `.${decodeURIComponent(resource)}`);
  if (!local.startsWith(distDirectory + path.sep) || !(await fs.stat(local)).isFile()) throw Error('Native resource is missing or outside dist.');
}
const socketAndLogSettleMilliseconds = 250;
const logFile = path.join(privateDirectory, 'origin-error.log');
const readLog = async () => { try { return await fs.readFile(logFile, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };
const report = {
  sourceHost: os.hostname(), utcStarted: new Date().toISOString(), method: 'HEAD', origin: 'http://127.0.0.1:8189',
  scope: 'Bounded waves of authenticated localhost HEAD requests. No retries or asset bodies. This measures listener/capacity behavior, not production GET transfer or GPU performance.',
  catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
  inventory: { sections: catalog.sections.length, uniquePaths: paths.length },
  originBefore: JSON.parse(await fs.readFile(path.join(privateDirectory, 'origin-state.json'), 'utf8')),
  trials: [],
};
for (const concurrency of waves) {
  const logBefore = await readLog();
  const started = performance.now();
  const trial = { concurrency, requests: paths.length, statuses: {}, errors: [], socketsCreated: 0,
    maxOpenClientSockets: 0, maxConnectedClientSockets: 0, maxRequestsInFlight: 0, responseBodyBytes: 0 };
  let openSockets = 0, connectedSockets = 0, activeRequests = 0, cursor = 0;
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency, maxFreeSockets: 100 });
  const createConnection = agent.createConnection.bind(agent);
  agent.createConnection = (...args) => {
    const socket = createConnection(...args);
    trial.socketsCreated++;
    trial.maxOpenClientSockets = Math.max(trial.maxOpenClientSockets, ++openSockets);
    let connected = false;
    socket.once('connect', () => { connected = true; trial.maxConnectedClientSockets = Math.max(trial.maxConnectedClientSockets, ++connectedSockets); });
    socket.once('close', () => { openSockets--; if (connected) connectedSockets--; });
    return socket;
  };
  const request = resource => new Promise(resolve => {
    trial.maxRequestsInFlight = Math.max(trial.maxRequestsInFlight, ++activeRequests);
    let completed = false;
    const complete = result => {
      if (completed) return;
      completed = true; activeRequests--;
      if (result.status) trial.statuses[result.status] = (trial.statuses[result.status] ?? 0) + 1;
      else trial.errors.push({ path: resource, code: result.code });
      resolve();
    };
    const req = http.request({ host: '127.0.0.1', port: 8189, path: resource, method: 'HEAD', agent,
      headers: { Cookie: `__Host-l2_preview=${key}` }, signal: AbortSignal.timeout(10_000) }, response => {
      response.on('data', data => { trial.responseBodyBytes += data.length; });
      response.once('end', () => complete({ status: response.statusCode }));
      response.once('error', error => complete({ code: error.code ?? 'RESPONSE_ERROR' }));
      response.resume();
    });
    req.once('error', error => complete({ code: error.code ?? 'REQUEST_ERROR' }));
    req.end();
  });
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
    while (cursor < paths.length) await request(paths[cursor++]);
  }));
  trial.wallMs = Math.round((performance.now() - started) * 100) / 100;
  agent.destroy();
  await new Promise(resolve => setTimeout(resolve, socketAndLogSettleMilliseconds));
  const logAfter = await readLog();
  trial.newOriginLog = sanitize(logAfter.startsWith(logBefore) ? logAfter.slice(logBefore.length) : logAfter);
  report.trials.push(trial);
  await fs.writeFile(path.join(evidence, `trial-${concurrency}.json`), sanitize(JSON.stringify(trial, null, 2)));
}
report.originAfter = JSON.parse(await fs.readFile(path.join(privateDirectory, 'origin-state.json'), 'utf8'));
report.utcFinished = new Date().toISOString();
await fs.writeFile(path.join(evidence, 'report.json'), sanitize(JSON.stringify(report, null, 2)));
console.log(JSON.stringify({ sourceHost: report.sourceHost, inventory: report.inventory,
  trials: report.trials.map(({ concurrency, requests, statuses, errors, wallMs, maxOpenClientSockets, maxConnectedClientSockets, maxRequestsInFlight, newOriginLog }) =>
    ({ concurrency, requests, statuses, errorCount: errors.length, errorCodes: [...new Set(errors.map(error => error.code))], wallMs,
      maxOpenClientSockets, maxConnectedClientSockets, maxRequestsInFlight, newOriginLog })) }, null, 2));

if (report.trials.some(trial => trial.errors.length > 0 || trial.statuses['200'] !== paths.length)) process.exitCode = 1;
