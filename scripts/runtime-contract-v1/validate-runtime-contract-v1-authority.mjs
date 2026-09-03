import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  RUNTIME_CONTRACT_PATHS,
  validateRuntimeContractV1,
} from "./validate-runtime-contract-v1.mjs";
import {
  AMENDMENT_DIGEST_KEYS,
  AMENDMENT_DIRECTORY,
  CHAIN_ANCHOR_PATH,
  assertRowsExplainDelta,
  composeAmendmentChain,
  equalDigests,
  loadAmendmentRecords,
} from "./amendment-chain.mjs";

export const RUNTIME_CONTRACT_AUTHORITY_PATH =
  "scripts/runtime-contract-v1/authority.json";

const EXPECTED_ARTIFACTS = Object.freeze(Object.values(RUNTIME_CONTRACT_PATHS));
const EXPECTED_SUPERSEDED_COMMITS = Object.freeze([
  "7b9f01675df11fbf9c3f0a40187bd865fd04a918",
  "cb0712563c4b3bb9e18d11f9651e45c92e1e5820",
  "2581a8723f70f1aa24b55265a836ef266ea65c73",
]);
const AMENDED_DIGEST_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(AMENDMENT_DIGEST_KEYS).map(([key, path]) => [path, key]),
));

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

function amendedDigests(texts) {
  return Object.fromEntries(
    Object.entries(AMENDMENT_DIGEST_KEYS).map(([key, path]) => [key, sha256(texts[path])]),
  );
}

function authorizedAmendmentTransition(path, before, after, states) {
  const key = AMENDED_DIGEST_KEYS[path];
  if (key) {
    const from = states.findIndex((state) => state[key] === sha256(before));
    const to = states.findLastIndex((state) => state[key] === sha256(after));
    return from >= 0 && to >= 0 && from <= to;
  }
  if (path !== RUNTIME_CONTRACT_PATHS.lineage) return false;
  const version = (text) => JSON.parse(text).versions?.[0] ?? {};
  const from = states.findIndex((state) => equalDigests(state, version(before)));
  const to = states.findLastIndex((state) => equalDigests(state, version(after)));
  return from >= 0 && to >= 0 && from <= to;
}

function verifiedAmendmentChain(readText, listAmendments, introducedTexts) {
  const anchor = amendedDigests(introducedTexts);
  const declared = JSON.parse(readText(CHAIN_ANCHOR_PATH));
  const entries = loadAmendmentRecords({
    listFiles: listAmendments,
    readJson: (path) => JSON.parse(readText(path)),
  });
  if (!equalDigests(declared, anchor)) {
    fail("chain anchor does not pin the introduction commit artifacts");
  }
  const chain = composeAmendmentChain({ anchor, entries });
  if (chain.pendingRepins.length > 0) {
    fail(`amendment ${chain.pendingRepins[0]} is pending a re-pin`);
  }
  return chain;
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
  const listAmendments = options.listAmendments ?? (() => readdirSync(AMENDMENT_DIRECTORY));
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

  const introducedTexts = {};
  const promotedTexts = {};
  const currentTexts = {};
  for (const path of authority.artifacts) {
    introducedTexts[path] = gitResult(
      runGit,
      ["show", `${authority.introductionCommit}:${path}`],
      `introduction artifact ${path} is unavailable`,
    );
    promotedTexts[path] = gitResult(
      runGit,
      ["show", `${promotionCommit}:${path}`],
      `promotion artifact ${path} is unavailable`,
    );
    currentTexts[path] = readText(path);
  }
  const chain = verifiedAmendmentChain(readText, listAmendments, introducedTexts);
  for (const path of authority.artifacts) {
    if (introducedTexts[path] !== promotedTexts[path] &&
        !authorizedAmendmentTransition(path, introducedTexts[path], promotedTexts[path], chain.states)) {
      fail(`${path} drifted between introduction and promotion commits`);
    }
    if (introducedTexts[path] !== currentTexts[path] &&
        !authorizedAmendmentTransition(path, introducedTexts[path], currentTexts[path], chain.states))
      fail(
        `${path} drifted from introduction commit ${authority.introductionCommit}`,
      );
  }
  if (!equalDigests(chain.terminal, amendedDigests(currentTexts))) {
    fail("amendment chain does not compose to the live artifacts");
  }
  const liveVersion = JSON.parse(currentTexts[RUNTIME_CONTRACT_PATHS.lineage]).versions?.[0] ?? {};
  if (!equalDigests(chain.terminal, liveVersion)) {
    fail("live lineage does not pin the composed amendment chain");
  }
  if (chain.consumed.length > 0) {
    assertRowsExplainDelta({
      rows: chain.rowsChanged,
      parentTexts: introducedTexts,
      childTexts: currentTexts,
    });
  }
  const candidate = validateRuntimeContractV1({ readText });
  return Object.freeze({
    ...candidate,
    amendments: Object.freeze([...chain.consumed]),
    amendedRows: Object.freeze([...chain.rowsChanged]),
    introductionCommit: authority.introductionCommit,
    promotionCommit,
    runtimeAbiFrozen: true,
    supersededCommits: Object.freeze([...authority.supersededCommits]),
  });
}
