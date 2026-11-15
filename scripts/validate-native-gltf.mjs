import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import validator from 'gltf-validator';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/validate-native-gltf.mjs model.glb report.json');
if (validator.version() !== '2.0.0-dev.3.10') throw new Error('Install the pinned gltf-validator with pnpm install --frozen-lockfile');
const bytes = new Uint8Array(await readFile(input));
const result = await validator.validateBytes(bytes, { maxIssues: 1000, uri: 'model.glb' });
const report = { schemaVersion: 1, tool: 'Khronos glTF Validator', version: validator.version(), sha256: createHash('sha256').update(bytes).digest('hex'), ...result };
// Validator timestamps describe the run, not the converted content hash.
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ errors: result.issues.numErrors, warnings: result.issues.numWarnings, report: output }) + '\n');
process.exitCode = result.issues.numErrors ? 1 : 0;
