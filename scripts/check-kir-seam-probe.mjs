import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const tests = readdirSync('scripts/kir-seam-probe')
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `scripts/kir-seam-probe/${name}`);
if (tests.length === 0) throw new Error('KIR seam probe found no tests');

const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('KIR seam probe: candidate B selected (typed semantic projection)');
console.log('KIR seam probe: candidate A rejected (lossy/order-dependent source debug serializer)');
console.log('KIR seam probe: candidate C rejected (private host-identity runner lowering)');
console.log('KIR seam probe: experimental only; kir.v1 remains unfrozen');
