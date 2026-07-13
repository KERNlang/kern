import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CORE_SOURCE = join(ROOT, 'packages/core/src');
const INTERNAL_DIRECTORY = join(CORE_SOURCE, 'runtime-envelope');
const CAPABILITY_SEAM = join(CORE_SOURCE, 'ir/semantics/internal-capability-interceptor.ts');
const EACH_RUNTIME = join(CORE_SOURCE, 'ir/semantics/each-runtime.ts');
const EFFECT_MACHINE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine.ts');
const EFFECT_MACHINE_SEQUENCE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-sequence.ts');
const EFFECT_MACHINE_STRUCTURE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-structure.ts');
const EFFECT_MACHINE_TYPES = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-types.ts');
const EFFECT_MACHINE_FILES = [
  EFFECT_MACHINE,
  EFFECT_MACHINE_SEQUENCE,
  EFFECT_MACHINE_STRUCTURE,
  EFFECT_MACHINE_TYPES,
];
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
const effectMachineSources = new Map(EFFECT_MACHINE_FILES.map((path) => [path, readFileSync(path, 'utf8')]));
const effectMachine = effectMachineSources.get(EFFECT_MACHINE);
const effectMachineSequence = effectMachineSources.get(EFFECT_MACHINE_SEQUENCE);
const effectMachineStructure = effectMachineSources.get(EFFECT_MACHINE_STRUCTURE);
const effectMachineTypes = effectMachineSources.get(EFFECT_MACHINE_TYPES);
const effectMachineFamily = [...effectMachineSources.values()].join('\n');
if (!effectMachineTypes.includes('kern.runtime.effect-machine.internal.r0')) {
  fail('effect machine format must remain exact and internal');
}
for (const forbidden of ['referenceRun(', 'referenceRunSequence(', 'asyncReferenceRun(', 'asyncReferenceRunSequence(']) {
  for (const [path, source] of effectMachineSources) {
    if (source.includes(forbidden)) {
      fail(`effect machine must not call legacy runner ${forbidden}: ${relative(ROOT, path)}`);
    }
  }
}
for (const witness of ['INTERNAL_EFFECT_MACHINE_DISPOSITION', "kind: 'capability'", 'yield Object.freeze']) {
  if (!effectMachineFamily.includes(witness)) fail(`effect machine is missing ${witness}`);
}
for (const witness of ["if: 'unified'", 'evaluateIfCondition', 'yield* runIf']) {
  if (!effectMachineFamily.includes(witness)) fail(`effect-machine if expansion is missing ${witness}`);
}
for (const witness of [
  "branch: 'unified'",
  'assertBranchFrameSupported',
  'assertInternalEffectMachineStructureSupported',
  'branchPreconditions',
  'branchShapePreconditions',
  'selectBranchPath',
  'childEnv(env)',
  'yield* runBranch',
]) {
  if (!effectMachineFamily.includes(witness)) fail(`effect-machine branch expansion is missing ${witness}`);
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
  if (!effectMachineFamily.includes(witness)) fail(`effect-machine while expansion is missing ${witness}`);
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
  if (!effectMachineFamily.includes(witness)) fail(`effect-machine for expansion is missing ${witness}`);
}
for (const witness of [
  "each: 'partial'",
  'isInternalEffectMachineArrayEach',
  'iterateEachRuntimeSteps',
  'yield* runEach',
  'defineBinding',
]) {
  if (!effectMachineFamily.includes(witness)) fail(`effect-machine each expansion is missing ${witness}`);
}
const eachRuntime = readFileSync(EACH_RUNTIME, 'utf8');
for (const witness of ['function* iterateEachRuntimeSteps', 'yield* iterateCollection', 'Array.from(iterateEachRuntimeSteps']) {
  if (!eachRuntime.includes(witness)) fail(`effect-machine each runtime is missing ${witness}`);
}
for (const witness of ["try: 'legacy'"]) {
  if (!effectMachineTypes.includes(witness)) fail(`effect-machine deferral is missing ${witness}`);
}
for (const [path, source] of effectMachineSources) {
  if (source.trimEnd().split('\n').length >= 500) {
    fail(`effect-machine source exceeds the handwritten line limit: ${relative(ROOT, path)}`);
  }
}
if (effectMachine.trimEnd().split('\n').length >= 300) {
  fail('effect-machine stable driver must remain below 300 lines');
}
for (const forbidden of ['internal-effect-machine-sequence', 'internal-effect-machine.ts', 'runtime-envelope']) {
  if (effectMachineStructure.includes(forbidden)) {
    fail(`effect-machine structure imports forbidden dependency ${forbidden}`);
  }
}
for (const forbidden of ['internal-effect-machine.ts', 'runtime-envelope']) {
  if (effectMachineSequence.includes(forbidden)) {
    fail(`effect-machine sequence imports forbidden dependency ${forbidden}`);
  }
}
for (const forbidden of ['internal-effect-machine-sequence', 'internal-effect-machine-structure', 'internal-effect-machine.ts']) {
  if (effectMachineTypes.includes(forbidden)) {
    fail(`effect-machine types import forbidden dependency ${forbidden}`);
  }
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
const effectMachineEachOwnership = policy.ownership.find(
  (entry) => entry.id === 'internal-runtime-effect-machine-each-array',
);
if (effectMachineEachOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect-machine array each expansion must remain an internal oracle');
}
const effectMachineArchitectureOwnership = policy.ownership.find(
  (entry) => entry.id === 'internal-runtime-effect-machine-architecture',
);
if (effectMachineArchitectureOwnership?.status !== 'internal-oracle') {
  fail('internal runtime effect-machine architecture boundary must remain an internal oracle');
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
