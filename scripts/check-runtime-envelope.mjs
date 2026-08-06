import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  assertExecutableEnvelopeDirectClosure,
  assertHandlerEnvelopeDirectClosure,
  assertPublicHandlerAbiClosure,
  assertPortableMachineEvaluatorClosure,
  assertRuntimeImportClosureExcludes,
  assertStableEffectMachineClosure,
} from './runtime-envelope-import-closure.mjs';

const ROOT = process.cwd();
const CORE_SOURCE = join(ROOT, 'packages/core/src');
const INTERNAL_DIRECTORY = join(CORE_SOURCE, 'runtime-envelope');
const PUBLIC_HANDLER = join(CORE_SOURCE, 'runtime-handler.ts');
const CAPABILITY_SEAM = join(CORE_SOURCE, 'ir/semantics/internal-capability-interceptor.ts');
const CAPABILITY_LANE = join(CORE_SOURCE, 'ir/semantics/capability-lane.ts');
const CAPABILITY_PLAN = join(CORE_SOURCE, 'runner-capability-plan.ts');
const SOURCE_RUNNER = join(CORE_SOURCE, 'runner.ts');
const EACH_RUNTIME = join(CORE_SOURCE, 'ir/semantics/each-runtime.ts');
const EFFECT_MACHINE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine.ts');
const EFFECT_MACHINE_SEQUENCE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-sequence.ts');
const EFFECT_MACHINE_STRUCTURE = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-structure.ts');
const EFFECT_MACHINE_TYPES = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-types.ts');
const EFFECT_MACHINE_TRY = join(CORE_SOURCE, 'ir/semantics/internal-effect-machine-try.ts');
const TRY_RUNTIME = join(CORE_SOURCE, 'ir/semantics/try-runtime.ts');
const LEGACY_TRY = join(CORE_SOURCE, 'ir/semantics/try.ts');
const LEGACY_BRANCH = join(CORE_SOURCE, 'ir/semantics/branch.ts');
const LEGACY_FOR = join(CORE_SOURCE, 'ir/semantics/for.ts');
const LEGACY_IF = join(CORE_SOURCE, 'ir/semantics/if.ts');
const LEGACY_WHILE = join(CORE_SOURCE, 'ir/semantics/while.ts');
const REFERENCE_RUNNER = join(CORE_SOURCE, 'ir/semantics/reference-runner.ts');
const ASYNC_REFERENCE_RUNNER = join(CORE_SOURCE, 'ir/semantics/async-reference-runner.ts');
const EFFECT_MACHINE_FILES = [
  EFFECT_MACHINE,
  EFFECT_MACHINE_SEQUENCE,
  EFFECT_MACHINE_STRUCTURE,
  EFFECT_MACHINE_TYPES,
  EFFECT_MACHINE_TRY,
];
const ENVELOPE_EXECUTE = join(INTERNAL_DIRECTORY, 'execute.ts');
const INTERNAL_ENGINE = join(INTERNAL_DIRECTORY, 'internal-engine.ts');
const INTERNAL_SCHEDULER = join(INTERNAL_DIRECTORY, 'internal-scheduler.ts');
const RUNTIME_ENVELOPE_EXTERNAL_IMPORTERS = new Set([CAPABILITY_SEAM, PUBLIC_HANDLER, SOURCE_RUNNER]);
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
const effectMachineTry = effectMachineSources.get(EFFECT_MACHINE_TRY);
const effectMachineFamily = [...effectMachineSources.values()].join('\n');
const tryRuntime = readFileSync(TRY_RUNTIME, 'utf8');
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
  'analyzeBranchFrame',
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
  "each: 'unified'",
  'isInternalEffectMachineEach',
  'internalEffectMachineEachIterationCount',
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
for (const witness of [
  "try: 'unified'",
  'runInternalEffectMachineTry',
  'tryRuntimeParts',
  'UNAVAILABLE_CAUGHT_ERROR',
  'machine.throw(error)',
]) {
  if (!effectMachineFamily.includes(witness)) fail(`effect-machine try ownership is missing ${witness}`);
}
for (const [path, source] of effectMachineSources) {
  if (source.trimEnd().split('\n').length >= 500) {
    fail(`effect-machine source exceeds the handwritten line limit: ${relative(ROOT, path)}`);
  }
}
if (effectMachine.trimEnd().split('\n').length >= 300) {
  fail('effect-machine stable driver must remain below 300 lines');
}
for (const forbidden of [
  'internal-effect-machine-sequence',
  'internal-effect-machine-try',
  'internal-effect-machine.js',
  'runtime-envelope',
]) {
  if (effectMachineStructure.includes(forbidden)) {
    fail(`effect-machine structure imports forbidden dependency ${forbidden}`);
  }
}
for (const forbidden of ['internal-effect-machine.js', 'runtime-envelope']) {
  if (effectMachineSequence.includes(forbidden)) {
    fail(`effect-machine sequence imports forbidden dependency ${forbidden}`);
  }
}
for (const forbidden of [
  'internal-effect-machine-sequence',
  'internal-effect-machine-structure',
  'internal-effect-machine.js',
  "from './try.js'",
  'reference-runner',
  'async-reference-runner',
  'runtime-envelope',
]) {
  if (effectMachineTry.includes(forbidden)) {
    fail(`effect-machine try imports forbidden dependency ${forbidden}`);
  }
}
for (const forbidden of [
  'internal-effect-machine-sequence',
  'internal-effect-machine-structure',
  'internal-effect-machine.js',
]) {
  if (effectMachineTypes.includes(forbidden)) {
    fail(`effect-machine types import forbidden dependency ${forbidden}`);
  }
}
for (const forbidden of ['internal-effect-machine', "from './try.js'", 'reference-runner', 'async-reference-runner']) {
  if (tryRuntime.includes(forbidden)) fail(`try runtime leaf imports forbidden dependency ${forbidden}`);
}
assertStableEffectMachineClosure(CORE_SOURCE);
assertPortableMachineEvaluatorClosure(CORE_SOURCE);
assertExecutableEnvelopeDirectClosure(CORE_SOURCE);
assertHandlerEnvelopeDirectClosure(CORE_SOURCE);
assertPublicHandlerAbiClosure(CORE_SOURCE);
assertRuntimeImportClosureExcludes(
  [EFFECT_MACHINE_TRY],
  [
    LEGACY_TRY,
    REFERENCE_RUNNER,
    ASYNC_REFERENCE_RUNNER,
    EFFECT_MACHINE,
    EFFECT_MACHINE_SEQUENCE,
    EFFECT_MACHINE_STRUCTURE,
  ],
);
assertRuntimeImportClosureExcludes(
  [CAPABILITY_LANE],
  [CAPABILITY_PLAN, LEGACY_TRY, REFERENCE_RUNNER, ASYNC_REFERENCE_RUNNER],
);
assertRuntimeImportClosureExcludes(
  [TRY_RUNTIME],
  [
    LEGACY_TRY,
    REFERENCE_RUNNER,
    ASYNC_REFERENCE_RUNNER,
    EFFECT_MACHINE,
    EFFECT_MACHINE_SEQUENCE,
    EFFECT_MACHINE_STRUCTURE,
    EFFECT_MACHINE_TYPES,
    EFFECT_MACHINE_TRY,
  ],
);
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
const publicHandlerExport = corePackage.exports?.['./runtime/handler'];
if (
  publicHandlerExport?.types !== './dist/runtime-handler.d.ts' ||
  publicHandlerExport?.default !== './dist/runtime-handler.js'
) {
  fail('package must expose the exact additive ./runtime/handler entry');
}
const publicHandler = readFileSync(PUBLIC_HANDLER, 'utf8');
if (!publicHandler.includes("'kern.runtime.handler.v1'")) {
  fail('public handler ABI format must remain exact');
}
if (publicHandler.trimEnd().split('\n').length >= 500) {
  fail('public runtime handler source exceeds the handwritten line limit');
}
const publicDeclaration = readFileSync(join(ROOT, 'packages/core/dist/runtime-handler.d.ts'), 'utf8');
for (const forbidden of ['Internal', 'SemanticEnv', 'KernRunner', 'runner-capabilities', 'kern.runtime.internal.r0']) {
  if (publicDeclaration.includes(forbidden)) fail(`public handler declaration exposes ${forbidden}`);
}

const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (rootPackage.scripts?.['test:runtime-abi'] === undefined) {
  fail('test:runtime-abi must exist after public ABI promotion');
}
if (rootPackage.scripts?.['test:kern-runtime-contract-v1'] === undefined) {
  fail('test:kern-runtime-contract-v1 must exist after runtime contract freeze');
}

const policy = JSON.parse(readFileSync(join(ROOT, 'scripts/kern-5-fitness-policy.json'), 'utf8'));
const publicGate = policy.gates.find((gate) => gate.id === 'runtime-handler-abi');
if (publicGate?.status !== 'current') {
  fail('runtime-handler-abi must be a current fitness gate after public promotion');
}
const publicHandlerOwnership = policy.ownership.find((entry) => entry.id === 'typed-runtime-handler-abi');
if (
  publicHandlerOwnership?.status !== 'internal-oracle' ||
  publicHandlerOwnership.evidence !== 'pnpm test:kern-runtime-contract-v1'
) {
  fail('typed runtime handler ABI must be a frozen default-off internal oracle with anchored v1 evidence');
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
if (eligibility.claims?.runtimeAbiFrozen !== true) {
  fail('KIR eligibility must state that the runtime ABI is independently frozen');
}
if (
  JSON.stringify(eligibility.deferredContracts) !==
  JSON.stringify([{ id: 'public-versioned-kir-runtime-cutover', milestone: 'R3-runtime-cutover' }])
) {
  fail('only the public versioned KIR-to-runtime cutover may remain deferred after the runtime contract freeze');
}

process.stdout.write(
  'runtime handler ABI: PASS (frozen default-off public facade; anchored v1 evidence; machine-only containment)\n',
);
