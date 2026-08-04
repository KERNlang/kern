import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RUNTIME_CONTRACT_AUTHORITY_PATH,
  validateRuntimeContractV1Authority,
} from "./validate-runtime-contract-v1-authority.mjs";

const authority = JSON.parse(
  readFileSync(RUNTIME_CONTRACT_AUTHORITY_PATH, "utf8"),
);
const syntheticCurrent = "f".repeat(40);
const syntheticPromotion = "b".repeat(40);

function runGit(argv) {
  if (argv[0] === "cat-file" || argv[0] === "merge-base")
    return { status: 0, stderr: "", stdout: "" };
  if (argv[0] === "ls-tree")
    return { status: 0, stderr: "", stdout: "" };
  if (argv[0] === "log")
    return { status: 0, stderr: "", stdout: `${syntheticPromotion}\n` };
  if (argv[0] === "show") {
    if (argv[1] === "-s") {
      return {
        status: 0,
        stderr: "",
        stdout: `${authority.introductionCommit}\n`,
      };
    }
    if (argv[1]?.startsWith(`${syntheticPromotion}:`)) {
      const path = argv[1].slice(syntheticPromotion.length + 1);
      return { status: 0, stderr: "", stdout: readFileSync(path, "utf8") };
    }
    return {
      status: 0,
      stderr: "",
      stdout: execFileSync("git", argv, { encoding: "utf8" }),
    };
  }
  throw new Error(`unexpected git command ${argv.join(" ")}`);
}

function mutateAuthority(change) {
  return {
    currentCommit: syntheticCurrent,
    readText(path) {
      if (path !== RUNTIME_CONTRACT_AUTHORITY_PATH)
        return readFileSync(path, "utf8");
      const copy = structuredClone(authority);
      change(copy);
      return `${JSON.stringify(copy, null, 2)}\n`;
    },
    runGit,
  };
}

test("promotion authority recovers the exact candidate artifacts from commit A", () => {
  const result = validateRuntimeContractV1Authority({
    currentCommit: syntheticCurrent,
    runGit,
  });
  assert.equal(result.introductionCommit, authority.introductionCommit);
  assert.equal(result.promotionCommit, syntheticPromotion);
  assert.equal(result.runtimeAbiFrozen, true);
  assert.deepEqual(result.supersededCommits, authority.supersededCommits);
});

for (const [name, change, error] of [
  [
    "short anchor",
    (copy) => {
      copy.introductionCommit = copy.introductionCommit.slice(0, 12);
    },
    /full commit SHA/u,
  ],
  [
    "artifact deletion",
    (copy) => copy.artifacts.pop(),
    /authority artifacts drifted/u,
  ],
  [
    "superseded deletion",
    (copy) => copy.supersededCommits.pop(),
    /superseded commits drifted/u,
  ],
  [
    "superseded replacement",
    (copy) => {
      copy.supersededCommits[0] = "e".repeat(40);
    },
    /superseded commits drifted/u,
  ],
  [
    "self authority field",
    (copy) => {
      copy.selfSha256 = "0".repeat(64);
    },
    /authority keys drifted/u,
  ],
]) {
  test(`authority rejects ${name}`, () => {
    assert.throws(
      () => validateRuntimeContractV1Authority(mutateAuthority(change)),
      error,
    );
  });
}

test("authority rejects A equal to the current commit", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: authority.introductionCommit,
        runGit,
      }),
    /must differ from HEAD/u,
  );
});

test("authority rejects superseded introduction and promotion commits", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority(
        mutateAuthority((copy) => {
          copy.introductionCommit = copy.supersededCommits[0];
        }),
      ),
    /introduction commit is superseded/u,
  );
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: authority.supersededCommits[1],
        runGit,
      }),
    /promotion commit is superseded/u,
  );
});

test("authority rejects an introduction commit containing its own authority record", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: syntheticCurrent,
        runGit(argv) {
          if (argv[0] === "ls-tree") {
            return {
              status: 0,
              stderr: "",
              stdout: `${RUNTIME_CONTRACT_AUTHORITY_PATH}\n`,
            };
          }
          return runGit(argv);
        },
      }),
    /must not contain an authority record/u,
  );
});

test("authority rejects a promotion commit that is not the immediate child of A", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: syntheticCurrent,
        runGit(argv) {
          if (argv[0] === "show" && argv[1] === "-s") {
            return { status: 0, stderr: "", stdout: `${"c".repeat(40)}\n` };
          }
          return runGit(argv);
        },
      }),
    /promotion commit must be the immediate child of introduction commit/u,
  );
});

test("authority rejects delete-and-readd promotion history", () => {
  assert.throws(
    () => validateRuntimeContractV1Authority({
      currentCommit: syntheticCurrent,
      runGit(argv) {
        if (argv[0] === "log") {
          return {
            status: 0,
            stderr: "",
            stdout: `${syntheticPromotion}\n${"c".repeat(40)}\n`,
          };
        }
        return runGit(argv);
      },
    }),
    /exactly one promotion introduction/u,
  );
});

test("authority rejects frozen artifact drift introduced in B then reverted", () => {
  assert.throws(
    () => validateRuntimeContractV1Authority({
      currentCommit: syntheticCurrent,
      runGit(argv) {
        if (
          argv[0] === "show" &&
          argv[1]?.startsWith(`${syntheticPromotion}:`) &&
          argv[1].endsWith("goldens.json")
        ) {
          return { status: 0, stderr: "", stdout: "drifted\n" };
        }
        return runGit(argv);
      },
    }),
    /goldens\.json drifted between introduction and promotion commits/u,
  );
});

test("authority rejects authority-record drift after B", () => {
  assert.throws(
    () => validateRuntimeContractV1Authority({
      currentCommit: syntheticCurrent,
      runGit(argv) {
        if (
          argv[0] === "show" &&
          argv[1] === `${syntheticPromotion}:${RUNTIME_CONTRACT_AUTHORITY_PATH}`
        ) {
          return {
            status: 0,
            stderr: "",
            stdout: `${readFileSync(RUNTIME_CONTRACT_AUTHORITY_PATH, "utf8")}\n`,
          };
        }
        return runGit(argv);
      },
    }),
    /authority record drifted from promotion commit/u,
  );
});

test("authority fails closed when the self-authority lookup fails", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: syntheticCurrent,
        runGit(argv) {
          if (argv[0] === "ls-tree")
            return { status: 128, stderr: "lookup failed", stdout: "" };
          return runGit(argv);
        },
      }),
    /authority lookup failed; fetch the pinned introduction commit history/u,
  );
});

test("authority fails closed when anchored history is unavailable", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: syntheticCurrent,
        runGit(argv) {
          if (argv[0] === "cat-file" && argv[2]?.endsWith("^{commit}")) {
            return { status: 1, stderr: "missing", stdout: "" };
          }
          return runGit(argv);
        },
      }),
    /fetch the pinned introduction commit history/u,
  );
});

test("authority rejects current artifact drift even when live lineage is rewritten", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: syntheticCurrent,
        readText(path) {
          const text = readFileSync(path, "utf8");
          return path.endsWith("goldens.json")
            ? text.replace("typed-return", "typed-return-drift")
            : text;
        },
        runGit,
      }),
    /goldens\.json drifted from introduction commit/u,
  );
});

test("authority rejects byte-only artifact drift", () => {
  assert.throws(
    () =>
      validateRuntimeContractV1Authority({
        currentCommit: syntheticCurrent,
        readText(path) {
          const text = readFileSync(path, "utf8");
          return path.endsWith("constitution.json") ? `${text}\n` : text;
        },
        runGit,
      }),
    /constitution\.json drifted from introduction commit/u,
  );
});
