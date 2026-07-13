import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CORE_SOURCE = join(ROOT, 'packages/core/src');
const INTERNAL_DIRECTORY = join(CORE_SOURCE, 'runtime-envelope');
const CAPABILITY_SEAM = join(CORE_SOURCE, 'ir/semantics/internal-capability-interceptor.ts');
const EFFECT_MACHINE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine.ts');
const ENVELOPE_EXECUTE = join(INTERNAL_DIRECTORY, 'execute.ts');
const INTERNAL_ENGINE = join(INTERNAL_DIRECTORY, 'internal-engine.ts');
const INTERNAL_SCHEDULER = join(INTERNAL_DIRECTORY, 'internal-scheduler.ts');
const RUNTIME_ENVELOPE_EXTERNAL_IMPORTERS = new Set([CAPABILITY_SEAM]);
const CAPABILITY_SEAM_IMPORTERS = new Set([
  CAPABILITY_SEAM,
  join(CORE_SOURCE, 'ir/semantics/async-reference-runner.ts'),
  join(CORE_SOURCE, 'ir/semantics/capability.ts'),
  EFFECT_MACHINE,
]);

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
  if (text.includes('runtime-envelope') && !RUNTIME_ENVELOPE_EXTERNAL_IMPORTERS.has(path)) {
    fail(`production adoption is forbidden outside the internal directory: ${relative(ROOT, path)}`);
  }
  if (text.includes('internal-capability-interceptor') && !CAPABILITY_SEAM_IMPORTERS.has(path)) {
    fail(`capability seam adoption is forbidden outside its semantic dispatchers: ${relative(ROOT, path)}`);
  }
}

const capabilitySeam = readFileSync(CAPABILITY_SEAM, 'utf8');
if (!capabilitySeam.includes("'kern.capability.request.internal.r0'")) {
  fail('capability seam request format must remain exact and internal');
}
const internalScheduler = readFileSync(INTERNAL_SCHEDULER, 'utf8');
for (const witness of ['execution-cancelled', 'execution-timeout', 'removeEventListener', 'clearTimeout']) {
  if (!internalScheduler.includes(witness)) fail(`internal scheduler is missing ${witness}`);
}
const effectMachine = readFileSync(EFFECT_MACHINE, 'utf8');
if (!effectMachine.includes('kern.runtime.effect-machine.internal.r0')) {
  fail('effect machine format must remain exact and internal');
}
for (const forbidden of ['referenceRun(', 'referenceRunSequence(', 'asyncReferenceRun(', 'asyncReferenceRunSequence(']) {
  if (effectMachine.includes(forbidden)) fail(`effect machine must not call legacy runner ${forbidden}`);
}
for (const witness of ['INTERNAL_EFFECT_MACHINE_DISPOSITION', "kind: 'capability'", 'yield Object.freeze']) {
  if (!effectMachine.includes(witness)) fail(`effect machine is missing ${witness}`);
}
for (const witness of ["if: 'unified'", 'evaluateIfCondition', 'yield* runIf']) {
  if (!effectMachine.includes(witness)) fail(`effect-machine if expansion is missing ${witness}`);
}
for (const witness of [
  "branch: 'unified'",
  'assertBranchFrameSupported',
  'assertMachineStructureSupported',
  'branchPreconditions',
  'branchShapePreconditions',
  'selectBranchPath',
  'childEnv(env)',
  'yield* runBranch',
]) {
  if (!effectMachine.includes(witness)) fail(`effect-machine branch expansion is missing ${witness}`);
}
for (const witness of [
  "break: 'unified'",
  "continue: 'unified'",
  "while: 'unified'",
  'evaluateWhileCondition',
  'WHILE_MAX_ITERATIONS',
  'markRepeatableLoopBody',
  'loopDepth',
  'yield* runWhile',
]) {
  if (!effectMachine.includes(witness)) fail(`effect-machine while expansion is missing ${witness}`);
}
for (const witness of [
  "for: 'unified'",
  'consumeIterationBudget',
  'forRuntimeRange',
  'forShapePreconditions',
  'iterationBudget',
  'defineIntBinding',
  'yield* runFor',
]) {
  if (!effectMachine.includes(witness)) fail(`effect-machine for expansion is missing ${witness}`);
}
for (const witness of ["each: 'legacy'", "try: 'legacy'"]) {
  if (!effectMachine.includes(witness)) fail(`effect-machine deferral is missing ${witness}`);
}
const envelopeExecute = readFileSync(ENVELOPE_EXECUTE, 'utf8');
for (const witness of [
  'accepted.limits.maxCollectionLength',
  'runInternalRuntimeEngineSync',
  'runInternalRuntimeEngineAsync',
]) {
  if (!envelopeExecute.includes(witness)) fail(`envelope execution is missing ${witness}`);
}
for (const forbidden of ['referenceRunSequence', 'asyncReferenceRunSequence']) {
  if (envelopeExecute.includes(forbidden)) fail(`envelope execution bypasses the internal engine via ${forbidden}`);
}
const internalEngine = readFileSync(INTERNAL_ENGINE, 'utf8');
for (const witness of ['selectInternalRuntimeEngine', 'runInternalEffectMachineSync', 'runInternalEffectMachineAsync']) {
  if (!internalEngine.includes(witness)) fail(`internal engine is missing ${witness}`);
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
const capabilityOwnership = policy.ownership.find((entry) => entry.id === 'internal-runtime-capability-seam');
if (capabilityOwnership?.status !== 'internal-oracle') {
  fail('internal runtime capability seam must remain an internal oracle');
}
const schedulerOwnership = policy.ownership.find((entry) => entry.id === 'internal-runtime-scheduler-control');
if (schedulerOwnership?.status !== 'internal-oracle') {
  fail('internal runtime scheduler control must remain an internal oracle');
}
const effectMachineOwnership = policy.ownership.find((entry) => entry.id === 'internal-runtime-effect-machine');
if (effectMachineOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect machine must remain an internal oracle');
}
const effectMachineIfOwnership = policy.ownership.find((entry) => entry.id === 'internal-runtime-effect-machine-if');
if (effectMachineIfOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect-machine if expansion must remain an internal oracle');
}
const effectMachineBranchOwnership = policy.ownership.find(
  (entry) => entry.id === 'internal-runtime-effect-machine-branch',
);
if (effectMachineBranchOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect-machine branch expansion must remain an internal oracle');
}
const effectMachineWhileOwnership = policy.ownership.find(
  (entry) => entry.id === 'internal-runtime-effect-machine-while',
);
if (effectMachineWhileOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect-machine while expansion must remain an internal oracle');
}
const effectMachineForOwnership = policy.ownership.find(
  (entry) => entry.id === 'internal-runtime-effect-machine-for',
);
if (effectMachineForOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect-machine for expansion must remain an internal oracle');
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
