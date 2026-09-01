import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const AMEND = resolve(ROOT, 'scripts/kern-frontend-closure/amend.mjs');
const POLICY = resolve(ROOT, 'scripts/kern-frontend-f5-projection/policy.json');
const KERN = resolve(ROOT, 'examples/kern-frontend/f5-property-projection.kern');
const AMENDMENT = resolve(ROOT, 'scripts/kern-frontend-closure/amendments/rt8-integer-signatures.json');
const SCRATCH = resolve(ROOT, 'scripts/kern-frontend-closure/amendments/zz-scratch.json');

function run(...args) {
  try {
    return { ok: true, out: execFileSync('node', [AMEND, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function withState(mutate, body) {
  const policy = readFileSync(POLICY, 'utf8');
  const kern = readFileSync(KERN, 'utf8');
  const amendment = readFileSync(AMENDMENT, 'utf8');
  try {
    mutate();
    body();
  } finally {
    writeFileSync(POLICY, policy);
    writeFileSync(KERN, kern);
    writeFileSync(AMENDMENT, amendment);
    rmSync(SCRATCH, { force: true });
  }
}

const drift = () => writeFileSync(KERN, `${readFileSync(KERN, 'utf8')}\n`);

test('the settled chain verifies and re-pinning is idempotent', () => {
  assert.match(run().out, /chain verified, 0 pending/u);
  const before = readFileSync(POLICY, 'utf8');
  assert.equal(run('--write').ok, true);
  assert.equal(readFileSync(POLICY, 'utf8'), before, 'a settled chain must not rewrite the pin');
});

test('drift with no amendment naming the file is refused and writes nothing', () => {
  withState(() => {
    rmSync(AMENDMENT);
    drift();
  }, () => {
    const before = readFileSync(POLICY, 'utf8');
    const result = run('--write');
    assert.equal(result.ok, false);
    assert.match(result.out, /drifted with no amendment naming it/u);
    assert.equal(readFileSync(POLICY, 'utf8'), before, 'a refused run must not write');
  });
});

test('an amendment whose parent digest is stale is refused', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.repin[0].parentDigest = '0'.repeat(64);
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
    drift();
  }, () => {
    const result = run('--write');
    assert.equal(result.ok, false);
    assert.match(result.out, /parent digest for .* is stale/u);
  });
});

test('an amendment naming a different composition file does not license this one', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.repin[0].path = 'examples/kern-frontend/f5-tree-projection.kern';
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
    drift();
  }, () => {
    const result = run('--write');
    assert.equal(result.ok, false);
    assert.match(result.out, /drifted with no amendment naming it/u);
  });
});

test('a stale parent closure-ledger digest invalidates the whole amendment', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.parentClosureLedgerSha256 = '0'.repeat(64);
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
  }, () => {
    assert.match(run().out, /parent ledger digest/u);
  });
});

test('an amendment that silently changes the node or property counts is refused', () => {
  for (const [key, value] of [['nodes', 303], ['properties', 1150]]) {
    withState(() => {
      const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
      amendment.counts[key] = value;
      writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
    }, () => {
      assert.match(run().out, new RegExp(`${key === 'nodes' ? 'node' : 'property'} count changed`, 'u'));
    });
  }
});

test('an amendment claiming a disposition the ledger does not carry is refused', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.rows.push({ stableKey: 'fn.name', disposition: 'invented-disposition' });
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
  }, () => {
    assert.match(run().out, /row fn.name/u);
  });
});

test('an amendment claiming more rows of a disposition than the ledger holds is refused', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.rows.push({ stableKey: 'fn.extra', disposition: 'lowered-type' });
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
  }, () => {
    assert.match(run().out, /claims unknown lowered-type rows/u);
  });
});

test('two amendments may not claim the same file', () => {
  withState(() => {
    copyFileSync(AMENDMENT, SCRATCH);
  }, () => {
    assert.match(run().out, /claimed by more than one amendment/u);
  });
});

test('a non-additive amendment is refused', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.change = 'replacing';
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
  }, () => {
    assert.match(run().out, /is not an additive amendment/u);
  });
});

test('a valid amendment re-pins exactly the declared entry and nothing else', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.repin[0].parentDigest = JSON.parse(readFileSync(POLICY, 'utf8'))
      .composition.find(({ path }) => path.endsWith('f5-property-projection.kern')).sha256;
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
    drift();
  }, () => {
    const before = JSON.parse(readFileSync(POLICY, 'utf8'));
    assert.equal(run('--write').ok, true);
    const after = JSON.parse(readFileSync(POLICY, 'utf8'));
    const changed = after.composition.filter((entry, index) => entry.sha256 !== before.composition[index].sha256);
    assert.deepEqual(changed.map(({ path }) => path), ['examples/kern-frontend/f5-property-projection.kern']);
    assert.deepEqual({ ...after, composition: null }, { ...before, composition: null }, 'no other policy field may move');
    assert.deepEqual(after.composition.map(({ path }) => path), before.composition.map(({ path }) => path));
  });
});

test('an amendment is single use: once consumed it cannot re-bless a later edit', () => {
  withState(() => {
    const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
    amendment.repin[0].parentDigest = JSON.parse(readFileSync(POLICY, 'utf8'))
      .composition.find(({ path }) => path.endsWith('f5-property-projection.kern')).sha256;
    writeFileSync(AMENDMENT, JSON.stringify(amendment, null, 2));
    drift();
  }, () => {
    assert.equal(run('--write').ok, true);
    drift();
    const settled = readFileSync(POLICY, 'utf8');
    const result = run('--write');
    assert.equal(result.ok, false);
    assert.match(result.out, /parent digest for .* is stale/u);
    assert.equal(readFileSync(POLICY, 'utf8'), settled, 'a consumed amendment must not write again');
  });
});

test('the amendment record stays load-bearing after it is consumed', () => {
  const amendment = JSON.parse(readFileSync(AMENDMENT, 'utf8'));
  assert.equal(amendment.id, 'rt8-integer-signatures');
  assert.equal(amendment.change, 'additive');
  assert.deepEqual(amendment.counts, { nodes: 302, properties: 1149 });
  assert.deepEqual(amendment.rows.map(({ stableKey }) => stableKey).sort(), ['fn.returns', 'param.type']);
  assert.ok(amendment.rows.every(({ disposition }) => disposition === 'lowered-type'));
  assert.deepEqual(amendment.addedSpellings.map(({ source }) => source), ['integer', 'integer[]']);
  assert.ok(amendment.addedSpellings.every(({ kirKind, element }) => kirKind === 'integer' || element === 'integer'));
  assert.equal(amendment.repin[0].path, 'examples/kern-frontend/f5-property-projection.kern');
});
