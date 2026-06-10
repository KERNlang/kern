/** Native-eligibility GOLDEN SNAPSHOT — the drift wall (grammar-sovereignty
 *  phase 1, step 0/1).
 *
 *  This regenerates the snapshot in-memory from the REAL classifiers
 *  (`classifyHandlerBodyAst`, `classifyClosureBlock`) over the shared corpus and
 *  asserts byte-for-byte deep-equality with the committed
 *  `__snapshots__/eligibility-golden.json`. Any change to a classifier verdict —
 *  intended or accidental — fails here until the snapshot is regenerated and the
 *  diff is reviewed:
 *
 *    pnpm --filter @kernlang/core build
 *    node scripts/eligibility-snapshot.mjs
 *
 *  It also asserts (a) every reason code the corpus claims is exercised at least
 *  once, with the structurally-unreachable codes accounted for explicitly, and
 *  (b) the reason-code universe `ALL_REASON_CODES` has not fallen behind the
 *  classifier source — a mechanical extraction of every reason literal from the
 *  three source files must match the declared list exactly.
 *
 *  SHADOW-ONLY: no production-path imports here. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_REASON_CODES,
  buildSnapshot,
  DYNAMIC_REASON_PREFIXES,
  UNTRIGGERABLE_REASON_CODES,
} from '../../../scripts/eligibility-corpus.mjs';
import { classifyClosureBlock } from '../src/closure-eligibility.js';
import { classifyHandlerBodyAst } from '../src/native-eligibility-ast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(__dirname, '__snapshots__/eligibility-golden.json');
const SRC_DIR = path.resolve(__dirname, '../src');

interface SnapshotRow {
  snippet: string;
  classifier: string;
  eligible: boolean;
  reason: string;
}

function regenerate(): SnapshotRow[] {
  return buildSnapshot({ classifyHandlerBodyAst, classifyClosureBlock });
}

function loadGolden(): SnapshotRow[] {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SnapshotRow[];
}

function isTriggered(code: string, present: Set<string>): boolean {
  if (DYNAMIC_REASON_PREFIXES.includes(code)) {
    return [...present].some((reason) => reason.startsWith(code));
  }
  return present.has(code);
}

/** Mechanically extract every reason-code literal from the classifier source.
 *  Mirrors the grep the snapshot script's docs describe — strips comments first
 *  so doc-example slugs never count, then matches returned / assigned / union /
 *  template-family reason literals. Returns the de-duplicated set, with the two
 *  dynamic families represented by their prefix slug. */
function extractReasonCodesFromSource(): Set<string> {
  const files = ['native-eligibility-ast.ts', 'closure-eligibility.ts', 'instanceof-rhs.ts'];
  const found = new Set<string>();
  for (const file of files) {
    const raw = readFileSync(path.join(SRC_DIR, file), 'utf-8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    for (const m of code.matchAll(/(?:return|reason\s*=|:)\s*'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)) {
      found.add(m[1]);
    }
    for (const m of code.matchAll(/`((?:closure-)?unsupported-stmt)-\$\{/g)) {
      found.add(`${m[1]}-`);
    }
    for (const m of code.matchAll(/reason:\s*'(empty|ok)'/g)) {
      found.add(m[1]);
    }
    for (const m of code.matchAll(/'(instanceof-rhs-[a-z-]+)'/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

describe('eligibility golden snapshot — drift wall', () => {
  test('committed snapshot deep-equals in-memory regeneration', () => {
    const regenerated = regenerate();
    const golden = loadGolden();
    expect(regenerated).toEqual(golden);
  });

  test('committed snapshot is byte-identical to the serialized regeneration', () => {
    // The script writes 2-space JSON + a trailing newline; the drift wall also
    // pins the exact on-disk bytes so a stray reformat is caught, not just a
    // structural change.
    const serialized = `${JSON.stringify(regenerate(), null, 2)}\n`;
    const onDisk = readFileSync(SNAPSHOT_PATH, 'utf-8');
    expect(onDisk).toBe(serialized);
  });

  test('regeneration is deterministic across two runs', () => {
    expect(regenerate()).toEqual(regenerate());
  });
});

describe('eligibility golden snapshot — reason-code coverage', () => {
  test('every triggerable reason code appears in the snapshot at least once', () => {
    const present = new Set(loadGolden().map((row) => row.reason));
    const untriggered = ALL_REASON_CODES.filter((code) => !isTriggered(code, present));
    // The only codes allowed to be absent are the explicitly-declared
    // structurally-unreachable ones. Anything else means the corpus regressed.
    expect([...untriggered].sort()).toEqual([...UNTRIGGERABLE_REASON_CODES].sort());
  });

  test('declared untriggerable codes are genuinely absent from the snapshot', () => {
    const present = new Set(loadGolden().map((row) => row.reason));
    for (const code of UNTRIGGERABLE_REASON_CODES) {
      expect(isTriggered(code, present)).toBe(false);
    }
  });

  test('ALL_REASON_CODES matches a mechanical extraction from the classifier source', () => {
    const fromSource = extractReasonCodesFromSource();
    const declared = new Set(ALL_REASON_CODES);
    const inSourceNotDeclared = [...fromSource].filter((code) => !declared.has(code)).sort();
    const inDeclaredNotInSource = [...declared].filter((code) => !fromSource.has(code)).sort();
    // Both directions must be empty: the list cannot fall behind the source
    // (a new reason code added without a corpus row), nor carry phantom codes.
    expect(inSourceNotDeclared).toEqual([]);
    expect(inDeclaredNotInSource).toEqual([]);
  });
});
