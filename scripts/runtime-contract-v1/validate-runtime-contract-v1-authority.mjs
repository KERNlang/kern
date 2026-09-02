import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  RUNTIME_CONTRACT_PATHS,
  validateRuntimeContractV1,
} from "./validate-runtime-contract-v1.mjs";

export const RUNTIME_CONTRACT_AUTHORITY_PATH =
  "scripts/runtime-contract-v1/authority.json";

const EXPECTED_ARTIFACTS = Object.freeze(Object.values(RUNTIME_CONTRACT_PATHS));
const EXPECTED_SUPERSEDED_COMMITS = Object.freeze([
  "7b9f01675df11fbf9c3f0a40187bd865fd04a918",
  "cb0712563c4b3bb9e18d11f9651e45c92e1e5820",
  "2581a8723f70f1aa24b55265a836ef266ea65c73",
]);
const AMENDMENT_PATH =
  "scripts/runtime-contract-v1/amendments/kern-5-runtime-envelope-max-iterations.json";
const AMENDED_DIGEST_KEYS = Object.freeze({
  "scripts/runtime-contract-v1/constitution.json": "constitutionSha256",
  "scripts/runtime-contract-v1/proof-inventory.json": "proofInventorySha256",
  "scripts/runtime-contract-v1/public-declaration-schema.json": "declarationSchemaSha256",
  "scripts/runtime-contract-v1/goldens.json": "goldensSha256",
});

function fail(message) {
  throw new Error(`runtime contract v1 authority: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be a record`);
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(keys))
    fail(`${label} keys drifted`);
}

function canonicalJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("authority must be JSON");
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text)
    fail("authority bytes must remain canonical");
  return value;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function authorizedAmendmentTransition(path, before, after, amendment) {
  const key = AMENDED_DIGEST_KEYS[path];
  if (key) {
    return sha256(before) === amendment.parentDigests[key] &&
      sha256(after) === amendment.resultDigests[key];
  }
  if (path !== RUNTIME_CONTRACT_PATHS.lineage) return false;
  const beforeVersion = JSON.parse(before).versions?.[0];
  const afterVersion = JSON.parse(after).versions?.[0];
  return Object.keys(AMENDED_DIGEST_KEYS).every((artifact) => {
    const digestKey = AMENDED_DIGEST_KEYS[artifact];
    return beforeVersion?.[digestKey] === amendment.parentDigests[digestKey] &&
      afterVersion?.[digestKey] === amendment.resultDigests[digestKey];
  });
}

function defaultRunGit(argv) {
  const result = spawnSync("git", argv, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function gitResult(runGit, argv, unavailableMessage) {
  const result = runGit(argv);
  if (result.status !== 0)
    fail(
      `${unavailableMessage}; fetch the pinned introduction commit history and retry`,
    );
  return result.stdout;
}

export function validateRuntimeContractV1Authority(options = {}) {
  const readText = options.readText ?? ((path) => readFileSync(path, "utf8"));
  const runGit = options.runGit ?? defaultRunGit;
  const authorityText = readText(RUNTIME_CONTRACT_AUTHORITY_PATH);
  const authority = canonicalJson(authorityText);
  const amendment = JSON.parse(readText(AMENDMENT_PATH));
  exactKeys(
    authority,
    ["format", "introductionCommit", "artifacts", "supersededCommits"],
    "authority",
  );
  if (authority.format !== "kern.runtime.contract.authority.v1")
    fail("authority format drifted");
  if (!/^[0-9a-f]{40}$/u.test(authority.introductionCommit))
    fail("introductionCommit must be a full commit SHA");
  if (
    JSON.stringify(authority.artifacts) !== JSON.stringify(EXPECTED_ARTIFACTS)
  )
    fail("authority artifacts drifted");
  if (
    JSON.stringify(authority.supersededCommits) !==
    JSON.stringify(EXPECTED_SUPERSEDED_COMMITS)
  ) {
    fail("superseded commits drifted");
  }
  if (authority.supersededCommits.includes(authority.introductionCommit)) {
    fail("introduction commit is superseded");
  }

  const currentCommit =
    options.currentCommit ??
    gitResult(
      runGit,
      ["rev-parse", "HEAD"],
      "current commit is unavailable",
    ).trim();
  if (!/^[0-9a-f]{40}$/u.test(currentCommit))
    fail("current commit must be a full commit SHA");
  if (authority.supersededCommits.includes(currentCommit))
    fail("current promotion commit is superseded");
  if (authority.introductionCommit === currentCommit)
    fail("introduction commit must differ from HEAD");
  gitResult(
    runGit,
    ["cat-file", "-e", `${authority.introductionCommit}^{commit}`],
    `introduction commit ${authority.introductionCommit} is unavailable`,
  );
  const selfAuthority = gitResult(
    runGit,
    [
      "ls-tree",
      "--name-only",
      authority.introductionCommit,
      "--",
      RUNTIME_CONTRACT_AUTHORITY_PATH,
    ],
    `introduction commit ${authority.introductionCommit} authority lookup failed`,
  ).trim();
  if (selfAuthority !== "")
    fail("introduction commit must not contain an authority record");
  gitResult(
    runGit,
    [
      "merge-base",
      "--is-ancestor",
      authority.introductionCommit,
      currentCommit,
    ],
    `introduction commit ${authority.introductionCommit} is not an ancestor of ${currentCommit}`,
  );

  const promotionCommits = gitResult(
    runGit,
    [
      "log",
      "--format=%H",
      "--diff-filter=A",
      "--full-history",
      currentCommit,
      "--",
      RUNTIME_CONTRACT_AUTHORITY_PATH,
    ],
    "promotion commit history is unavailable",
  ).trim().split(/\s+/u).filter(Boolean);
  if (promotionCommits.length !== 1) {
    fail("authority record must have exactly one promotion introduction in HEAD history");
  }
  const [promotionCommit] = promotionCommits;
  const promotionParents = gitResult(
    runGit,
    ["show", "-s", "--format=%P", promotionCommit],
    `promotion commit ${promotionCommit} parent lookup failed`,
  ).trim().split(/\s+/u).filter(Boolean);
  if (
    promotionParents.length !== 1 ||
    promotionParents[0] !== authority.introductionCommit
  ) {
    fail("promotion commit must be the immediate child of introduction commit");
  }
  gitResult(
    runGit,
    ["merge-base", "--is-ancestor", promotionCommit, currentCommit],
    `promotion commit ${promotionCommit} is not an ancestor of ${currentCommit}`,
  );
  const promotedAuthority = gitResult(
    runGit,
    ["show", `${promotionCommit}:${RUNTIME_CONTRACT_AUTHORITY_PATH}`],
    `promotion authority record is unavailable at ${promotionCommit}`,
  );
  if (promotedAuthority !== authorityText) {
    fail(`authority record drifted from promotion commit ${promotionCommit}`);
  }

  for (const path of authority.artifacts) {
    const introduced = gitResult(
      runGit,
      ["show", `${authority.introductionCommit}:${path}`],
      `introduction artifact ${path} is unavailable`,
    );
    const promoted = gitResult(
      runGit,
      ["show", `${promotionCommit}:${path}`],
      `promotion artifact ${path} is unavailable`,
    );
    if (introduced !== promoted &&
        !authorizedAmendmentTransition(path, introduced, promoted, amendment)) {
      fail(`${path} drifted between introduction and promotion commits`);
    }
    const current = readText(path);
    if (introduced !== current &&
        !authorizedAmendmentTransition(path, introduced, current, amendment))
      fail(
        `${path} drifted from introduction commit ${authority.introductionCommit}`,
      );
  }
  const candidate = validateRuntimeContractV1({ readText });
  return Object.freeze({
    ...candidate,
    introductionCommit: authority.introductionCommit,
    promotionCommit,
    runtimeAbiFrozen: true,
    supersededCommits: Object.freeze([...authority.supersededCommits]),
  });
}
