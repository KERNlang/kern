import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const PATHS = Object.freeze({
  constitution: "scripts/runtime-contract-v1/constitution.json",
  proofInventory: "scripts/runtime-contract-v1/proof-inventory.json",
  declarationSchema:
    "scripts/runtime-contract-v1/public-declaration-schema.json",
  goldens: "scripts/runtime-contract-v1/goldens.json",
  lineage: "scripts/runtime-contract-v1/lineage.json",
});

const EXPECTED_HASHES = Object.freeze({
  constitution:
    "f25716593bbb2d9417ab004438baf34085befb0cfc25f4bf22276b6277ec6d96",
  proofInventory:
    "4a8dbec281ac89709431e26f9e142ce15f14958310d233f88a393bba46212a57",
  declarationSchema:
    "16fb0ac434f5124265167835879dc3c1a7ffad94dc0a01d52d85b44943d13828",
  goldens: "bb2e3b34ec936a9f88b45a94a80500f110f18ed3e7be7e7caf4062de2610f15c",
  lineage: "5501947055b963ef9e81ca4365ca0fb3323a0c3aca5b3db5410ca583685ac802",
});

const EXPECTED = Object.freeze({
  imports: [
    "runtime-esm-import",
    "runtime-esm-re-export",
    "import-equals-require",
    "direct-literal-require",
    "literal-dynamic-import",
    "package-entry",
    "source-alias",
    "built-javascript",
  ],
  dynamic: [
    "Bun",
    "Deno",
    "Function",
    "WebAssembly",
    "constructor",
    "createRequire",
    "eval",
    "global",
    "globalThis",
    "importScripts",
    "module",
    "process",
  ],
  behavior: [
    ["success-typed-return", ["sync", "async"]],
    ["success-capability-transcript", ["sync", "async"]],
    ["failure-link", ["sync", "async"]],
    ["failure-uncaught-throw", ["sync", "async"]],
    ["failure-invalid-handler-arguments", ["sync", "async"]],
    ["failure-unsupported-handler", ["sync", "async"]],
    ["failure-invalid-capability-input", ["sync", "async"]],
    ["failure-invalid-provider-result", ["sync", "async"]],
    ["failure-declared-result-mismatch", ["sync", "async"]],
    ["scheduler-pre-aborted", ["sync", "async"]],
    ["scheduler-timeout", ["async"]],
    ["portable-value-rejection", ["sync", "async"]],
  ],
  ingress: [
    "disabled",
    "invalid-abi",
    "invalid-request",
    "invalid-limits",
    "invalid-options",
  ],
  limits: [
    "maxBytes",
    "maxCollectionLength",
    "maxDepth",
    "maxDiagnostics",
    "maxEvents",
    "maxIterations",
    "maxStringBytes",
  ],
  enforcement: [
    "bytes",
    "collection",
    "depth",
    "diagnostics",
    "events",
    "string-bytes",
  ],
  scheduler: [
    "invalid-input-no-scheduler",
    "invalid-input-live-signal",
    "invalid-input-pre-aborted",
    "invalid-input-timeout",
    "invalid-input-signal-timeout",
  ],
  effects: [
    "pre-invalid-abi",
    "pre-invalid-request",
    "pre-invalid-options",
    "pre-invalid-limits",
    "pre-unsupported-handler",
    "pre-invalid-arguments",
    "pre-invalid-capability-input",
    "post-invalid-provider-result",
    "post-declared-result-mismatch",
  ],
  symbols: [
    "KERN_RUNTIME_HANDLER_ABI",
    "KernRuntimeHandlerCapabilityValue",
    "KernRuntimeHandlerCapabilityCall",
    "KernRuntimeHandlerCapabilityContext",
    "KernRuntimeHandlerCapability",
    "KernRuntimeHandlerAsyncCapability",
    "KernRuntimeHandlerCapabilities",
    "KernRuntimeHandlerAsyncCapabilities",
    "KernRuntimeHandlerLimits",
    "KernRuntimeHandlerIdentity",
    "KernRuntimeHandlerRequest",
    "KernRuntimeHandlerValue",
    "KernRuntimeHandlerSlot",
    "KernRuntimeHandlerEvent",
    "KernRuntimeHandlerDiagnosticCode",
    "KernRuntimeHandlerDiagnostic",
    "KernRuntimeHandlerEnvelope",
    "KernRuntimeHandlerOptions",
    "KernRuntimeHandlerAsyncOptions",
    "KernRuntimeHandlerError",
    "executeKernRuntimeHandlerSync",
    "executeKernRuntimeHandlerAsync",
  ],
});

function fail(message) {
  throw new Error(`runtime contract v1 proof floor: ${message}`);
}

function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(`${label} drifted`);
}

function canonical(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} must be JSON`);
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text)
    fail(`${label} bytes are noncanonical`);
  return value;
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

function declarationNames(sourceFile) {
  return sourceFile.statements.map((statement) => {
    if (ts.isVariableStatement(statement)) {
      const [declaration] = statement.declarationList.declarations;
      return declaration && ts.isIdentifier(declaration.name)
        ? declaration.name.text
        : null;
    }
    return statement.name && ts.isIdentifier(statement.name)
      ? statement.name.text
      : null;
  });
}

function canonicalDeclarations(sourceFile) {
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: true,
  });
  return sourceFile.statements.map((statement) =>
    printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile).trim(),
  );
}

export function validateRuntimeContractV1ProofFloor(options = {}) {
  const readText = options.readText ?? ((path) => readFileSync(path, "utf8"));
  const declarationText =
    options.declarationText ??
    readText("packages/core/dist/runtime-handler.d.ts");
  const texts = Object.fromEntries(
    Object.entries(PATHS).map(([id, path]) => [id, readText(path)]),
  );
  for (const [id, text] of Object.entries(texts)) {
    if (digest(text) !== EXPECTED_HASHES[id])
      fail(`${id} authority bytes drifted`);
  }
  const proof = canonical(texts.proofInventory, "proof inventory");
  const schema = canonical(texts.declarationSchema, "declaration schema");
  const goldens = canonical(texts.goldens, "goldens");
  same(proof.importEdges, EXPECTED.imports, "import edge floor");
  same(
    proof.forbiddenDynamicBindings,
    EXPECTED.dynamic,
    "dynamic binding floor",
  );
  same(
    proof.behavior.map(({ id, modes }) => [id, modes]),
    EXPECTED.behavior,
    "behavior floor",
  );
  same(
    proof.ingress.map(({ id }) => id),
    EXPECTED.ingress,
    "ingress floor",
  );
  same(
    proof.limitValidation.map(({ id }) => id),
    EXPECTED.limits,
    "limit validation floor",
  );
  same(
    proof.limitEnforcement.map(({ id }) => id),
    EXPECTED.enforcement,
    "limit enforcement floor",
  );
  same(
    proof.schedulerEffects.map(({ id }) => id),
    EXPECTED.scheduler,
    "scheduler floor",
  );
  same(
    proof.effects.map(({ id }) => id),
    EXPECTED.effects,
    "effect floor",
  );
  same(
    goldens.cases.map(({ id, modes }) => [id, modes]),
    EXPECTED.behavior,
    "golden behavior floor",
  );
  same(
    goldens.ingress.map(({ id }) => id),
    EXPECTED.ingress,
    "golden ingress floor",
  );
  same(
    goldens.limitValidation.map(({ id }) => id),
    EXPECTED.limits,
    "golden limit floor",
  );
  same(
    goldens.limitEnforcement.map(({ id }) => id),
    EXPECTED.enforcement,
    "golden enforcement floor",
  );
  same(
    goldens.schedulerEffects.map(({ id }) => id),
    EXPECTED.scheduler,
    "golden scheduler floor",
  );
  const sourceFile = ts.createSourceFile(
    "runtime-handler.d.ts",
    declarationText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if ((sourceFile.parseDiagnostics ?? []).length > 0)
    fail("built declaration does not parse");
  same(
    declarationNames(sourceFile),
    EXPECTED.symbols,
    "built declaration symbol floor",
  );
  same(
    canonicalDeclarations(sourceFile),
    schema.declarations,
    "built complete declaration floor",
  );
  return Object.freeze({
    behaviorCount: EXPECTED.behavior.length,
    declarationCount: EXPECTED.symbols.length,
  });
}
