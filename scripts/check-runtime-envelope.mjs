import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CORE_SOURCE = join(ROOT, 'packages/core/src');
const INTERNAL_DIRECTORY = join(CORE_SOURCE, 'runtime-envelope');

function fail(message) {
  throw new Error(`internal runtime envelope: ${message}`);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

for (const path of sourceFiles(CORE_SOURCE)) {
  if (path.startsWith(`${INTERNAL_DIRECTORY}/`)) continue;
  const text = readFileSync(path, 'utf8');
  if (text.includes('runtime-envelope')) {
    fail(`production adoption is forbidden outside the internal directory: ${relative(ROOT, path)}`);
  }
}

const corePackage = JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8'));
for (const [name, target] of Object.entries(corePackage.exports ?? {})) {
  if (`${name}\n${JSON.stringify(target)}`.includes('runtime-envelope')) {
    fail(`package export ${name} exposes the internal module`);
  }
}

const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (Object.hasOwn(rootPackage.scripts ?? {}, 'test:runtime-abi')) {
  fail('test:runtime-abi must remain absent until the public ABI gate is promoted');
}

const policy = JSON.parse(readFileSync(join(ROOT, 'scripts/kern-5-fitness-policy.json'), 'utf8'));
const publicGate = policy.gates.find((gate) => gate.id === 'runtime-handler-abi');
if (publicGate?.status !== 'planned') {
  fail('runtime-handler-abi must remain planned during the internal envelope slice');
}

const eligibility = JSON.parse(readFileSync(join(ROOT, 'scripts/kir-v1/eligibility.json'), 'utf8'));
if (eligibility.claims?.runtimeAbiFrozen !== false) {
  fail('KIR eligibility must continue to state that the runtime ABI is unfrozen');
}
for (const id of ['trace-abi', 'handler-abi', 'capability-abi']) {
  if (!eligibility.deferredContracts?.some((contract) => contract.id === id)) {
    fail(`${id} must remain explicitly deferred`);
  }
}

process.stdout.write('internal runtime envelope: PASS (default-off containment; public ABI remains deferred)\n');
