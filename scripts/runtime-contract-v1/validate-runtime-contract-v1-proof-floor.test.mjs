import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateRuntimeContractV1ProofFloor } from "./validate-runtime-contract-v1-proof-floor.mjs";

function mutate(path, change) {
  return {
    readText(candidate) {
      const text = readFileSync(candidate, "utf8");
      if (candidate !== path) return text;
      const value = JSON.parse(text);
      change(value);
      return `${JSON.stringify(value, null, 2)}\n`;
    },
  };
}

test("independent promotion proof floor accepts the exact A2 authority", () => {
  assert.deepEqual(validateRuntimeContractV1ProofFloor(), {
    behaviorCount: 12,
    declarationCount: 22,
  });
});

for (const [name, path, change] of [
  [
    "three-golden corpus",
    "scripts/runtime-contract-v1/goldens.json",
    (value) => {
      value.cases = value.cases.slice(0, 3);
    },
  ],
  [
    "dynamic-loader omission",
    "scripts/runtime-contract-v1/proof-inventory.json",
    (value) => {
      value.forbiddenDynamicBindings.pop();
    },
  ],
  [
    "effect omission",
    "scripts/runtime-contract-v1/proof-inventory.json",
    (value) => {
      value.effects.pop();
    },
  ],
  [
    "declaration schema widening",
    "scripts/runtime-contract-v1/public-declaration-schema.json",
    (value) => {
      value.declarations[10] = value.declarations[10].replace("unknown", "any");
    },
  ],
]) {
  test(`independent proof floor rejects ${name}`, () => {
    assert.throws(
      () => validateRuntimeContractV1ProofFloor(mutate(path, change)),
      /proof floor/u,
    );
  });
}

test("independent proof floor rejects a widened built declaration", () => {
  const declaration = readFileSync(
    "packages/core/dist/runtime-handler.d.ts",
    "utf8",
  );
  const widened = declaration.replace(
    "readonly arguments: readonly unknown[];",
    "readonly arguments: readonly any[];",
  );
  assert.notEqual(widened, declaration);
  assert.throws(
    () => validateRuntimeContractV1ProofFloor({ declarationText: widened }),
    /built complete declaration floor drifted/u,
  );
});
