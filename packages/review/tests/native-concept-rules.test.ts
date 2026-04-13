import type { ConceptEdge, ConceptMap, ConceptNode, IRNode } from '@kernlang/core';
import { parseDocument } from '@kernlang/core';
import { lintKernIR, loadBuiltinNativeRules } from '../src/kern-lint.js';
import { buildRuleIndex, conceptEdgeToIR, conceptNodeToIR, evaluateRule, matchPattern } from '../src/rule-eval.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeConceptNode(
  overrides: Partial<ConceptNode> & { kind: ConceptNode['kind']; payload: ConceptNode['payload'] },
): ConceptNode {
  return {
    id: `test#${overrides.kind}@0`,
    primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
    evidence: 'test',
    confidence: 0.9,
    language: 'ts',
    ...overrides,
  };
}

function makeConceptEdge(
  overrides: Partial<ConceptEdge> & { kind: ConceptEdge['kind']; payload: ConceptEdge['payload'] },
): ConceptEdge {
  return {
    id: `test#${overrides.kind}@0`,
    sourceId: 'test.ts',
    targetId: 'target',
    primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
    evidence: 'test',
    confidence: 0.9,
    language: 'ts',
    ...overrides,
  };
}

function makeConcepts(nodes: ConceptNode[], edges: ConceptEdge[] = []): ConceptMap {
  return { filePath: 'test.ts', language: 'typescript', nodes, edges, extractorVersion: '1' };
}

function parseRule(source: string): IRNode {
  const doc = parseDocument(source);
  const rules = (doc.children || []).filter((n) => n.type === 'rule');
  if (rules.length === 0) throw new Error('No rule found in source');
  return rules[0];
}

// ── conceptNodeToIR ──────────────────────────────────────────────────────

describe('conceptNodeToIR', () => {
  it('converts a concept node to IR shape with _concept marker', () => {
    const cn = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'ignored', errorVariable: 'e' },
    });
    const ir = conceptNodeToIR(cn);

    expect(ir.type).toBe('error_handle');
    expect(ir.props?._concept).toBe(true);
    expect(ir.props?.disposition).toBe('ignored');
    expect(ir.props?.errorVariable).toBe('e');
    expect(ir.props?.evidence).toBe('test');
    expect(ir.props?.confidence).toBe(0.9);
    expect(ir.loc?.line).toBe(1);
    expect(ir.children).toEqual([]);
  });

  it('flattens payload — skips kind field (already the node type)', () => {
    const cn = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const ir = conceptNodeToIR(cn);

    expect(ir.type).toBe('effect');
    expect(ir.props?.subtype).toBe('network');
    expect(ir.props?.target).toBe('fetch');
    expect(ir.props?.async).toBe(true);
    // 'kind' from payload should NOT be in props (it's the node type)
    expect(ir.props?.kind).toBeUndefined();
  });

  it('includes containerId when present', () => {
    const cn = makeConceptNode({
      kind: 'guard',
      containerId: 'test.ts#handleRequest',
      payload: { kind: 'guard', subtype: 'auth', name: 'isAdmin' },
    });
    const ir = conceptNodeToIR(cn);
    expect(ir.props?.containerId).toBe('test.ts#handleRequest');
  });
});

// ── conceptEdgeToIR ──────────────────────────────────────────────────────

describe('conceptEdgeToIR', () => {
  it('converts a concept edge to IR shape with edge metadata and upLevels', () => {
    const ce = makeConceptEdge({
      kind: 'dependency',
      targetId: '../../../shared/module',
      payload: { kind: 'dependency', subtype: 'internal', specifier: '../../../shared/module' },
    });
    const ir = conceptEdgeToIR(ce);

    expect(ir.type).toBe('dependency');
    expect(ir.props?._concept).toBe(true);
    expect(ir.props?._edge).toBe(true);
    expect(ir.props?.subtype).toBe('internal');
    expect(ir.props?.specifier).toBe('../../../shared/module');
    expect(ir.props?.upLevels).toBe(3);
    expect(ir.props?.sourceId).toBe('test.ts');
    expect(ir.props?.targetId).toBe('../../../shared/module');
    expect(ir.children).toEqual([]);
  });
});

// ── subject=concept filtering ────────────────────────────────────────────

describe('subject=concept filtering in matchPattern', () => {
  it('subject=concept matches concept nodes', () => {
    const cn = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'ignored', errorVariable: 'e' },
    });
    const irTarget = conceptNodeToIR(cn);
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    // Pattern with subject=concept
    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'error_handle', disposition: 'ignored' },
      children: [],
    };

    const result = matchPattern(pattern, irTarget, index);
    expect(result.matched).toBe(true);
  });

  it('subject=concept rejects IR nodes', () => {
    const irNode: IRNode = {
      type: 'guard',
      props: { name: 'isAuth' },
      children: [],
    };
    const index = buildRuleIndex([irNode]);

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'guard' },
      children: [],
    };

    const result = matchPattern(pattern, irNode, index);
    expect(result.matched).toBe(false);
  });

  it('default (no subject) excludes concept nodes', () => {
    const cn = makeConceptNode({
      kind: 'guard',
      payload: { kind: 'guard', subtype: 'auth', name: 'isAdmin' },
    });
    const irTarget = conceptNodeToIR(cn);
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    // Pattern WITHOUT subject — should NOT match concept nodes
    const pattern: IRNode = {
      type: 'pattern',
      props: { type: 'guard' },
      children: [],
    };

    const result = matchPattern(pattern, irTarget, index);
    expect(result.matched).toBe(false);
  });

  it('default (no subject) still matches IR nodes', () => {
    const irNode: IRNode = {
      type: 'guard',
      props: { name: 'isAuth' },
      children: [],
    };
    const index = buildRuleIndex([irNode]);

    const pattern: IRNode = {
      type: 'pattern',
      props: { type: 'guard' },
      children: [],
    };

    const result = matchPattern(pattern, irNode, index);
    expect(result.matched).toBe(true);
  });
});

// ── Full rule evaluation with concepts ───────────────────────────────────

describe('evaluateRule with concept matching', () => {
  it('ignored-error rule fires on ignored error_handle concept', () => {
    const rule = parseRule(`
rule ignored-error severity=error category=bug
  pattern subject=concept type=error_handle disposition=ignored
  message "Error is caught but ignored — handle, log, or rethrow"
    `);

    const cn = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'ignored', errorVariable: 'e' },
    });
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('ignored-error');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toBe('Error is caught but ignored — handle, log, or rethrow');
  });

  it('ignored-error rule does NOT fire on logged error_handle', () => {
    const rule = parseRule(`
rule ignored-error severity=error category=bug
  pattern subject=concept type=error_handle disposition=ignored
  message "Error is caught but ignored — handle, log, or rethrow"
    `);

    const cn = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'logged', errorVariable: 'e' },
    });
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(0);
  });

  it('boundary-mutation rule fires on global state_mutation', () => {
    const rule = parseRule(`
rule boundary-mutation-global severity=warning category=pattern
  pattern subject=concept type=state_mutation scope=global
  message "Global state mutation — consider encapsulating in a store or module"
    `);

    const cn = makeConceptNode({
      kind: 'state_mutation',
      payload: { kind: 'state_mutation', scope: 'global', target: 'cache' },
    });
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('boundary-mutation-global');
  });

  it('boundary-mutation rule does NOT fire on local state_mutation', () => {
    const rule = parseRule(`
rule boundary-mutation-global severity=warning category=pattern
  pattern subject=concept type=state_mutation scope=global
  message "Global state mutation — consider encapsulating in a store or module"
    `);

    const cn = makeConceptNode({
      kind: 'state_mutation',
      payload: { kind: 'state_mutation', scope: 'local', target: 'x' },
    });
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(0);
  });

  it('concept rules do not interfere with IR-only rules', () => {
    // An IR-only rule (no subject) should not fire on concept nodes
    const irRule = parseRule(`
rule guard-without-else severity=warning category=pattern
  pattern type=guard
    guard not=true prop=else
  message "Guard has no else action"
    `);

    const cn = makeConceptNode({
      kind: 'guard',
      payload: { kind: 'guard', subtype: 'auth', name: 'isAdmin' },
    });
    const irNode: IRNode = {
      type: 'guard',
      props: { name: 'isAuth' },
      children: [],
      loc: { line: 5, col: 3 },
    };
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([irNode], concepts);

    const findings = evaluateRule(irRule, index, 'test.ts');
    // Should only fire on the IR guard (no else prop), not the concept guard
    expect(findings.length).toBe(1);
    expect(findings[0].primarySpan.startLine).toBe(5);
  });

  it('message interpolation works with concept node props', () => {
    const rule = parseRule(`
rule effect-unprotected severity=warning category=bug
  pattern subject=concept type=effect subtype=network
  message "Unprotected {{subtype}} effect targeting {{target}}"
    `);

    const cn = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const concepts = makeConcepts([cn]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
    expect(findings[0].message).toBe('Unprotected network effect targeting fetch');
  });

  it('multiple concept nodes — only matches matching ones', () => {
    const rule = parseRule(`
rule ignored-error severity=error category=bug
  pattern subject=concept type=error_handle disposition=ignored
  message "Error is caught but ignored"
    `);

    const ignored = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'ignored', errorVariable: 'e' },
    });
    const logged = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'logged', errorVariable: 'err' },
    });
    const effect = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const concepts = makeConcepts([ignored, logged, effect]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('works with empty IR nodes (Python path)', () => {
    const rule = parseRule(`
rule ignored-error severity=error category=bug
  pattern subject=concept type=error_handle disposition=ignored
  message "Error is caught but ignored"
    `);

    const cn = makeConceptNode({
      kind: 'error_handle',
      payload: { kind: 'error_handle', disposition: 'ignored', errorVariable: 'e' },
    });
    const concepts = makeConcepts([cn]);
    // Empty IR nodes — this is the Python review path
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.py');
    expect(findings.length).toBe(1);
    expect(findings[0].primarySpan.file).toBe('test.py');
  });
});

// ── Subject edge cases (from review feedback) ───────────────────────────

describe('subject edge cases', () => {
  it('subject=ir does NOT match concept nodes', () => {
    const cn = makeConceptNode({
      kind: 'guard',
      payload: { kind: 'guard', subtype: 'auth', name: 'isAdmin' },
    });
    const irTarget = conceptNodeToIR(cn);
    const index = buildRuleIndex([], makeConcepts([cn]));

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'ir', type: 'guard' },
      children: [],
    };

    const result = matchPattern(pattern, irTarget, index);
    expect(result.matched).toBe(false);
  });

  it('unknown subject value does NOT match concept nodes', () => {
    const cn = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const irTarget = conceptNodeToIR(cn);
    const index = buildRuleIndex([], makeConcepts([cn]));

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'unknown', type: 'effect' },
      children: [],
    };

    const result = matchPattern(pattern, irTarget, index);
    expect(result.matched).toBe(false);
  });
});

// ── OR matching (pipe-separated values) ──────────────────────────────────

describe('OR matching with pipe-separated values', () => {
  it('subtype=network|db matches network', () => {
    const cn = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const irTarget = conceptNodeToIR(cn);
    const index = buildRuleIndex([], makeConcepts([cn]));

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'effect', subtype: 'network|db' },
      children: [],
    };

    expect(matchPattern(pattern, irTarget, index).matched).toBe(true);
  });

  it('subtype=network|db matches db', () => {
    const cn = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'db', target: 'pg', async: true },
    });
    const irTarget = conceptNodeToIR(cn);
    const index = buildRuleIndex([], makeConcepts([cn]));

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'effect', subtype: 'network|db' },
      children: [],
    };

    expect(matchPattern(pattern, irTarget, index).matched).toBe(true);
  });

  it('subtype=network|db rejects fs', () => {
    const cn = makeConceptNode({
      kind: 'effect',
      payload: { kind: 'effect', subtype: 'fs', target: 'readFile', async: true },
    });
    const irTarget = conceptNodeToIR(cn);
    const index = buildRuleIndex([], makeConcepts([cn]));

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'effect', subtype: 'network|db' },
      children: [],
    };

    expect(matchPattern(pattern, irTarget, index).matched).toBe(false);
  });
});

// ── Numeric prop comparisons ─────────────────────────────────────────────

describe('numeric prop comparisons in matchPattern', () => {
  it('min-upLevels matches concept dependency edges with enough ../ segments', () => {
    const edge = makeConceptEdge({
      kind: 'dependency',
      payload: { kind: 'dependency', subtype: 'internal', specifier: '../../../shared/module' },
    });
    const concepts = makeConcepts([], [edge]);
    const index = buildRuleIndex([], concepts);
    const target = conceptEdgeToIR(edge);

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'dependency', subtype: 'internal', 'min-upLevels': 3 },
      children: [],
    };

    expect(matchPattern(pattern, target, index).matched).toBe(true);
  });

  it('max-upLevels rejects concept dependency edges above the limit', () => {
    const edge = makeConceptEdge({
      kind: 'dependency',
      payload: { kind: 'dependency', subtype: 'internal', specifier: '../../../shared/module' },
    });
    const concepts = makeConcepts([], [edge]);
    const index = buildRuleIndex([], concepts);
    const target = conceptEdgeToIR(edge);

    const pattern: IRNode = {
      type: 'pattern',
      props: { subject: 'concept', type: 'dependency', 'max-upLevels': 2 },
      children: [],
    };

    expect(matchPattern(pattern, target, index).matched).toBe(false);
  });
});

// ── Peer guards (container-scoped) ───────────────────────────────────────

describe('peer guards (container-scoped concept matching)', () => {
  it('unguarded-effect fires when no auth guard in same container', () => {
    const rule = parseRule(`
rule unguarded-effect severity=warning category=bug
  pattern subject=concept type=effect subtype=network|db
    guard not=true peer=containerId
      pattern subject=concept type=guard subtype=auth|validation
  message "Network/DB effect without auth/validation guard"
    `);

    const effect = makeConceptNode({
      kind: 'effect',
      containerId: 'test.ts#handler',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const concepts = makeConcepts([effect]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('unguarded-effect');
  });

  it('unguarded-effect does NOT fire when auth guard exists in same container', () => {
    const rule = parseRule(`
rule unguarded-effect severity=warning category=bug
  pattern subject=concept type=effect subtype=network|db
    guard not=true peer=containerId
      pattern subject=concept type=guard subtype=auth|validation
  message "Network/DB effect without auth/validation guard"
    `);

    const effect = makeConceptNode({
      kind: 'effect',
      containerId: 'test.ts#handler',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const guard = makeConceptNode({
      kind: 'guard',
      containerId: 'test.ts#handler',
      payload: { kind: 'guard', subtype: 'auth', name: 'isAdmin' },
    });
    const concepts = makeConcepts([effect, guard]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(0);
  });

  it('guard in different container does NOT suppress the finding', () => {
    const rule = parseRule(`
rule unguarded-effect severity=warning category=bug
  pattern subject=concept type=effect subtype=network|db
    guard not=true peer=containerId
      pattern subject=concept type=guard subtype=auth|validation
  message "Network/DB effect without auth/validation guard"
    `);

    const effect = makeConceptNode({
      kind: 'effect',
      containerId: 'test.ts#handler',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const guard = makeConceptNode({
      kind: 'guard',
      containerId: 'test.ts#otherHandler',
      payload: { kind: 'guard', subtype: 'auth', name: 'isAdmin' },
    });
    const concepts = makeConcepts([effect, guard]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('unrecovered-effect fires when no error_handle in same container', () => {
    const rule = parseRule(`
rule unrecovered-effect severity=warning category=bug
  pattern subject=concept type=effect subtype=network|db
    guard not=true peer=containerId
      pattern subject=concept type=error_handle disposition=wrapped|returned|rethrown|retried
  message "effect without error recovery"
    `);

    const effect = makeConceptNode({
      kind: 'effect',
      containerId: 'test.ts#handler',
      payload: { kind: 'effect', subtype: 'db', target: 'pg', async: true },
    });
    const concepts = makeConcepts([effect]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(1);
  });

  it('unrecovered-effect suppressed by wrapped error_handle in same container', () => {
    const rule = parseRule(`
rule unrecovered-effect severity=warning category=bug
  pattern subject=concept type=effect subtype=network|db
    guard not=true peer=containerId
      pattern subject=concept type=error_handle disposition=wrapped|returned|rethrown|retried
  message "effect without error recovery"
    `);

    const effect = makeConceptNode({
      kind: 'effect',
      containerId: 'test.ts#handler',
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const handler = makeConceptNode({
      kind: 'error_handle',
      containerId: 'test.ts#handler',
      payload: { kind: 'error_handle', disposition: 'wrapped', errorVariable: 'e' },
    });
    const concepts = makeConcepts([effect, handler]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    expect(findings.length).toBe(0);
  });

  it('effect without containerId still fires (no peers to find)', () => {
    const rule = parseRule(`
rule unguarded-effect severity=warning category=bug
  pattern subject=concept type=effect subtype=network|db
    guard not=true peer=containerId
      pattern subject=concept type=guard subtype=auth|validation
  message "Unguarded effect"
    `);

    const effect = makeConceptNode({
      kind: 'effect',
      // no containerId
      payload: { kind: 'effect', subtype: 'network', target: 'fetch', async: true },
    });
    const concepts = makeConcepts([effect]);
    const index = buildRuleIndex([], concepts);

    const findings = evaluateRule(rule, index, 'test.ts');
    // guard not=true peer=containerId: target has no containerId → peer check fails → result=false → negated → true
    // So the pattern matches (unguarded)
    expect(findings.length).toBe(1);
  });
});

// ── Built-in native rules on concept edges ───────────────────────────────

describe('illegal-dependency native rule', () => {
  it('fires on deep internal dependency edges from the built-in .kern rule', () => {
    const rules = loadBuiltinNativeRules();
    const concepts = makeConcepts(
      [],
      [
        makeConceptEdge({
          kind: 'dependency',
          payload: { kind: 'dependency', subtype: 'internal', specifier: '../../../shared/module' },
        }),
        makeConceptEdge({
          id: 'test#dependency@1',
          kind: 'dependency',
          payload: { kind: 'dependency', subtype: 'internal', specifier: '../../shared/module' },
        }),
      ],
    );

    const findings = lintKernIR([], rules, concepts).filter((f) => f.ruleId === 'illegal-dependency');

    expect(findings.length).toBe(1);
    expect(findings[0].message).toBe('Deep cross-boundary import — may violate module architecture');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].category).toBe('structure');
    expect(findings[0].confidence).toBe(0.8);
  });
});
