/**
 * Tests for AST schema validation.
 * Verifies that validateSchema catches malformed ASTs before they reach codegen.
 */

import { parse } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';

function validate(source: string) {
  const root = parse(source);
  return validateSchema(root);
}

describe('Schema Validation', () => {
  describe('assign op', () => {
    it('rejects unsupported compound assignment operators at schema validation', () => {
      const v = validate(
        ['fn name=bad returns=void', '  handler lang="kern"', '    assign target=x op="&&=" value=next'].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'assign op=' supports only"))).toBe(true);
    });

    it('allows preserved body comments inside nested native body containers', () => {
      const v = validate(
        [
          'fn name=ok returns=number',
          '  handler lang="kern"',
          '    while cond="ready"',
          '      comment raw="// in while"',
          '      break',
          '    for name=i from=0 to=2',
          '      comment raw="// in for"',
          '      continue',
          '    try',
          '      comment raw="// in try"',
          '      return value=1',
          '    catch name=err',
          '      comment raw="// in catch"',
          '      return value=0',
          '    finally',
          '      comment raw="// in finally"',
          '      do value="cleanup()"',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });
  });

  describe('required props', () => {
    it('passes valid interface', () => {
      const v = validate(['interface name=User', '  field name=id type=string'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('flags interface missing name', () => {
      const v = validate('interface extends=Base');
      expect(v.some((v) => v.message.includes("'interface' requires prop 'name'"))).toBe(true);
    });

    it('flags field missing name', () => {
      const v = validate(['interface name=User', '  field type=string'].join('\n'));
      expect(v.some((v) => v.message.includes("'field' requires prop 'name'"))).toBe(true);
    });

    it('passes valid machine', () => {
      const v = validate(
        ['machine name=Order', '  state name=pending', '  transition name=confirm from=pending to=confirmed'].join(
          '\n',
        ),
      );
      expect(v).toHaveLength(0);
    });

    it('flags transition missing from', () => {
      const v = validate(
        ['machine name=Order', '  state name=pending', '  transition name=confirm to=confirmed'].join('\n'),
      );
      expect(v.some((v) => v.message.includes("'transition' requires prop 'from'"))).toBe(true);
    });

    it('flags store missing required props', () => {
      const v = validate('store name=Plan');
      expect(v.some((v) => v.message.includes("requires prop 'path'"))).toBe(true);
      expect(v.some((v) => v.message.includes("requires prop 'key'"))).toBe(true);
      expect(v.some((v) => v.message.includes("requires prop 'model'"))).toBe(true);
    });

    it('flags import missing from', () => {
      const v = validate('import names="foo,bar"');
      expect(v.some((v) => v.message.includes("'import' requires prop 'from'"))).toBe(true);
    });

    it('passes valid import', () => {
      const v = validate('import from="./utils" names="add"');
      expect(v).toHaveLength(0);
    });

    it('passes valid RAG declarations and flags missing required graph props', () => {
      const valid = validate(
        [
          'corpus name=Docs',
          '  source name=manuals uri="./docs/**/*.md"',
          '  chunking source=manuals strategy=semantic maxTokens=600 overlap=80',
          'embed name=DocsEmbedding corpus=Docs',
          'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding topK=8 minScore=0.72',
          'rag name=AnswerDocs retriever=DocsSearch',
          '  grounding requireCitations=true maxContext=6000',
          '  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract',
          '    ragCase name=refunds query="How do refunds work?"',
          '      ragAssert kind=scoreGte threshold=0.72',
          '  ragAnswerContract name=RefundAnswer query="How do refunds work?" answer="Refunds follow policy." minGroundingCoverage=0.8',
          '    answerSpan start=0 end=22 chunks=refunds required=true',
        ].join('\n'),
      );
      expect(valid).toHaveLength(0);

      const missing = validate(
        [
          'corpus',
          'source name=missingUri',
          'embed name=NoCorpus',
          'retriever name=NoCorpus',
          'rag name=NoRetriever',
          'ragAnswerContract query="q"',
          'answerSpan start=0 end=1',
        ].join('\n'),
      );
      expect(missing.some((violation) => violation.message.includes("'corpus' requires prop 'name'"))).toBe(true);
      expect(missing.some((violation) => violation.message.includes("'source' requires prop 'uri'"))).toBe(true);
      expect(missing.some((violation) => violation.message.includes("'embed' requires prop 'corpus'"))).toBe(true);
      expect(missing.some((violation) => violation.message.includes("'retriever' requires prop 'corpus'"))).toBe(true);
      expect(missing.some((violation) => violation.message.includes("'rag' requires prop 'retriever'"))).toBe(true);
      expect(missing.some((violation) => violation.message.includes("'ragAnswerContract' requires prop 'name'"))).toBe(
        true,
      );
      expect(
        missing.some((violation) => violation.message.includes("'ragAnswerContract' requires prop 'answer'")),
      ).toBe(true);
      expect(missing.some((violation) => violation.message.includes("'answerSpan' requires prop 'chunks'"))).toBe(true);

      const misplaced = validate(
        ['retriever name=DocsSearch corpus=Docs', '  grounding requireCitations=true'].join('\n'),
      );
      expect(
        misplaced.some((violation) => violation.message.includes("'retriever' does not allow child type 'grounding'")),
      ).toBe(true);

      const nestedEmbed = validate(['corpus name=Docs', '  embed name=DocsEmbedding corpus=Docs'].join('\n'));
      expect(
        nestedEmbed.some((violation) => violation.message.includes("'corpus' does not allow child type 'embed'")),
      ).toBe(true);

      const invalidAssertKind = validate(
        [
          'corpus name=Docs',
          'retriever name=DocsSearch corpus=Docs',
          'rag name=AnswerDocs retriever=DocsSearch',
          '  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract',
          '    ragCase name=refunds query="How do refunds work?"',
          '      ragAssert kind=unsupported',
        ].join('\n'),
      );
      expect(
        invalidAssertKind.some((violation) => violation.message.includes("'ragAssert' prop 'kind' must be one of")),
      ).toBe(true);
    });

    it('passes explicit foreign handler metadata', () => {
      const v = validate(
        [
          'fn name=bridge',
          '  handler lang=ts reason="express response adapter" review=manual <<<',
          '    return res.json({ ok: true });',
          '  >>>',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('rejects foreign handler metadata on native KERN handlers', () => {
      const v = validate(
        ['fn name=bridge', '  handler lang=kern reason="already native"', '    return value=ok'].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('metadata requires an explicit non-kern `lang=`'))).toBe(
        true,
      );
    });

    it('rejects foreign handler metadata on case-variant native KERN handlers', () => {
      const v = validate(
        ['fn name=bridge', '  handler lang=KERN reason="already native"', '    return value=ok'].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('metadata requires an explicit non-kern `lang=`'))).toBe(
        true,
      );
    });

    it('rejects foreign handler metadata without explicit lang', () => {
      const v = validate(
        ['fn name=bridge', '  handler reason="adapter glue" <<<', '    return res.json({ ok: true });', '  >>>'].join(
          '\n',
        ),
      );
      expect(v.some((violation) => violation.message.includes('metadata requires an explicit non-kern `lang=`'))).toBe(
        true,
      );
    });

    it('passes target-specific external imports', () => {
      const v = validate(
        ['import from=react registry=npm names=useMemo', 'import from=numpy registry=pypi names=array'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('passes package extern boundaries with app-level target aliases', () => {
      const v = validate(
        ['extern package=react registry=npm target=react', '  import names="useState,useEffect"'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows module-level package extern boundaries', () => {
      const v = validate(
        ['module name=app', '  extern package=react registry=npm target=react names=useState'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags incompatible external import registry targets', () => {
      const npm = validate('import from=react registry=npm target=python names=useMemo');
      const pypiImport = validate('import from=numpy registry=pypi target=ts names=array');
      const pypiExtern = validate('extern package=numpy registry=pypi target=react names=array');

      expect(npm.some((v) => v.message.includes("'import registry=npm' must target a TS-family target"))).toBe(true);
      expect(pypiImport.some((v) => v.message.includes("'import registry=pypi' must target python/fastapi"))).toBe(
        true,
      );
      expect(pypiExtern.some((v) => v.message.includes("'extern registry=pypi' must target python/fastapi"))).toBe(
        true,
      );
    });

    it('passes capability island metadata and child imports', () => {
      const v = validate(
        [
          'island engine Claude runtime=node effects=[network,stream,secret] serialization=stream requiresSidecar=false',
          '  import npm "@anthropic-ai/sdk" as Anthropic',
        ].join('\n'),
      );
      expect(v).toEqual([]);
    });

    it('flags invalid capability metadata values', () => {
      const v = validate('island engine Bad runtime=wasm effects=[network,telepathy] serialization=pickle');
      expect(v.some((violation) => violation.message.includes("'island runtime=' must be one of"))).toBe(true);
      expect(v.some((violation) => violation.message.includes("unsupported effect 'telepathy'"))).toBe(true);
      expect(v.some((violation) => violation.message.includes("'island serialization=' must be one of"))).toBe(true);
    });

    it('flags unsupported capability protocols', () => {
      const v = validate('island sidecar Bad runtime=python protocol=pty-sesion requiresSidecar=true');
      expect(v.some((violation) => violation.message.includes("'island protocol=' must be one of pty-session"))).toBe(
        true,
      );
    });

    it('flags missing and empty island names', () => {
      expect(validate('island runtime=node').some((v) => v.message.includes("'island' requires prop 'name'"))).toBe(
        true,
      );
      expect(
        validate('island engine runtime=node').some((v) => v.message.includes("'island' requires prop 'name'")),
      ).toBe(true);
      expect(
        validate('island name="" runtime=node').some((v) =>
          v.message.includes("'island name=' must be a non-empty identifier"),
        ),
      ).toBe(true);
    });

    it('allows islands to carry local implementation functions', () => {
      const v = validate(['island engine Claude runtime=node', '  fn name=run'].join('\n'));
      expect(v.some((violation) => violation.message.includes("'island' does not allow child type 'fn'"))).toBe(false);
    });

    it('allows island nodes where externs are allowed in MCP and CLI parents', () => {
      expect(
        validate(
          [
            'mcp name=server',
            '  island engine Claude runtime=node effects=[network,secret]',
            '    import npm "@anthropic-ai/sdk" as Anthropic',
          ].join('\n'),
        ),
      ).toEqual([]);
      expect(
        validate(
          [
            'cli name=tool',
            '  command name=run',
            '    island engine OpenCode runtime=node effects=[exec,stream] requiresSidecar=true',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    it('flags extern missing package', () => {
      const v = validate('extern registry=npm target=react names=useMemo');
      expect(v.some((v) => v.message.includes("'extern' requires prop 'package'"))).toBe(true);
      expect(v.some((v) => v.message.includes("'extern package=' must be a non-empty package specifier"))).toBe(false);
    });

    it('flags invalid extern targets', () => {
      const v = validate('extern package=react registry=npm target=reacts names=useMemo');
      expect(v.some((v) => v.message.includes("'extern target=' must be one of"))).toBe(true);
    });

    it('flags empty extern package boundaries', () => {
      const v = validate('extern package="" registry=npm target=react names=useMemo');
      expect(v.some((v) => v.message.includes("'extern package=' must be a non-empty package specifier"))).toBe(true);
    });

    it('flags invalid extern children', () => {
      const v = validate(['extern package=react registry=npm target=react', '  fn name=bad'].join('\n'));
      expect(v.some((v) => v.message.includes("'extern' does not allow child type 'fn'"))).toBe(true);
    });

    it('flags extern child imports that override boundary props', () => {
      const v = validate(
        ['extern package=react registry=npm target=react', '  import package=react-dom names=createRoot'].join('\n'),
      );
      expect(v.some((v) => v.message.includes("cannot set 'package'"))).toBe(true);
    });

    it('allows extern child imports to use package subpaths', () => {
      const v = validate(
        [
          'extern package=react-dom registry=npm target=react',
          '  import from="react-dom/client" names=createRoot',
        ].join('\n'),
      );
      expect(v).toEqual([]);
    });

    it('flags extern child imports outside the parent package boundary', () => {
      const v = validate(
        ['extern package=react registry=npm target=react', '  import from=lodash names=map'].join('\n'),
      );
      expect(v.some((v) => v.message.includes("must reference package 'react'"))).toBe(true);
    });

    it('allows extern where import is allowed in MCP and CLI parents', () => {
      expect(validate(['mcp name=server', '  extern package=zod registry=npm target=mcp names=z'].join('\n'))).toEqual(
        [],
      );
      expect(
        validate(['cli name=tool', '  extern package=commander registry=npm target=cli names=program'].join('\n')),
      ).toEqual([]);
      expect(
        validate(
          ['cli name=tool', '  command name=run', '    extern package=chalk registry=npm target=cli names=green'].join(
            '\n',
          ),
        ),
      ).toEqual([]);
    });

    it('flags assume missing evidence and fallback', () => {
      const v = validate('assume expr={{true}}');
      expect(v.some((v) => v.message.includes("requires prop 'evidence'"))).toBe(true);
      expect(v.some((v) => v.message.includes("requires prop 'fallback'"))).toBe(true);
    });

    it('passes valid guard', () => {
      const v = validate('guard name=check expr={{x > 0}}');
      expect(v).toHaveLength(0);
    });

    it('passes guard with kind (MCP security guard)', () => {
      const v = validate('guard type=sanitize param=query');
      expect(v).toHaveLength(0);
    });

    it('flags guard missing both expr and kind/type', () => {
      const v = validate('guard name=check');
      expect(v.some((v) => v.message.includes("'guard' requires either"))).toBe(true);
    });

    it('passes fmt binding form (name + template)', () => {
      const v = validate('fmt name=label template="${x}"');
      expect(v).toHaveLength(0);
    });

    it('passes fmt return form (return=true + template, no name)', () => {
      const v = validate('fmt return=true template="${ms}ms"');
      expect(v).toHaveLength(0);
    });

    it('accepts fmt without name/return=true (inline-JSX form — positional check is semantic)', () => {
      // Schema passes; `fmt-inline-must-be-inside-render` fires from the
      // semantic validator when the node is placed outside `render`/`group`.
      const v = validate('fmt template="${x}"');
      expect(v.some((v) => v.message.includes("'fmt' requires"))).toBe(false);
    });

    it('flags fmt with return=true AND a name prop', () => {
      const v = validate('fmt name=label return=true template="${x}"');
      expect(v.some((v) => v.message.includes("must not carry a 'name' prop"))).toBe(true);
    });

    it('flags derive missing expr', () => {
      const v = validate('derive name=total');
      expect(v.some((v) => v.message.includes("requires prop 'expr'"))).toBe(true);
    });

    it('flags collect missing from', () => {
      const v = validate('collect name=items');
      expect(v.some((v) => v.message.includes("requires prop 'from'"))).toBe(true);
    });

    it('passes valid union', () => {
      const v = validate(
        ['union name=Shape discriminant=kind', '  variant name=circle', '    field name=r type=number'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags union missing discriminant', () => {
      // Bare `union name=Shape` has no variants to infer from — the actionable
      // diagnostic surfaces a "set explicitly" hint instead of a candidates
      // list. See union-discriminant-inference.test.ts for inference paths.
      const v = validate('union name=Shape');
      expect(v.some((v) => v.message.includes('requires discriminant=<field>'))).toBe(true);
    });
  });

  describe('allowed children', () => {
    it('flags wrong child type in interface', () => {
      const v = validate(['interface name=User', '  method name=foo'].join('\n'));
      expect(v.some((v) => v.message.includes("does not allow child type 'method'"))).toBe(true);
    });

    it('allows field in interface', () => {
      const v = validate(['interface name=User', '  field name=id type=string'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('allows handler as universal child', () => {
      // handler is a universal child allowed everywhere
      const v = validate(['fn name=foo', '  handler <<<return 1;>>>'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('flags wrong child in machine', () => {
      const v = validate(['machine name=Order', '  field name=x type=string'].join('\n'));
      expect(v.some((v) => v.message.includes("does not allow child type 'field'"))).toBe(true);
    });

    it('allows state and transition in machine', () => {
      const v = validate(
        ['machine name=Order', '  state name=pending', '  transition name=start from=pending to=running'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native structural expect assertions inside tests', () => {
      const v = validate(
        [
          'test name="Order invariants" target="./order.kern"',
          '  it name="reaches paid"',
          '    expect machine=Order reaches=paid via=confirm,capture',
          '  it name="declares capture transition"',
          '    expect machine=Order transition=capture from=confirmed to=paid guarded=true',
          '  it name="derive graph"',
          '    expect no=deriveCycles',
          '  it name="machine states stay live"',
          '    expect machine=Order no=deadStates',
          '  it name="guard covers payment variants"',
          '    expect guard=ChargeCard exhaustive=true over=Payment',
          '  it name="uses a preset"',
          '    expect preset=mcpSafety severity=warn',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native behavioral expect assertions with scoped fixtures', () => {
      const v = validate(
        [
          'test name="Order behavior" target="./order.kern"',
          '  fixture name=paidOrder value={{({ items: [{ price: 20, qty: 2 }] })}}',
          '  describe name="totals"',
          '    fixture name=taxRate value=0.2',
          '    it name="calculates subtotal and tax"',
          '      expect fn=orderSubtotal with=paidOrder equals=40',
          '      expect fn=addTax args={{[orderSubtotal(paidOrder), taxRate]}} equals=48',
          '      expect derive=total equals=48',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native effect mocks inside test cases', () => {
      const v = validate(
        [
          'test name="Effect behavior" target="./effects.kern"',
          '  it name="mocks effect boundary"',
          '    mock effect=fetchUsers returns={{users}}',
          '    expect effect=fetchUsers returns={{users}}',
          '  it name="mocks failures"',
          '    mock effect=fetchUsers throws=NetworkError',
          '    expect effect=fetchUsers throws=NetworkError',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native tool workflow expect assertions with scoped mocks', () => {
      const target = validate(
        [
          'mcp name=Files',
          '  tool name=readFile',
          '    param name=filePath type=string required=true',
          '    effect name=readDisk',
          '      trigger url="/fs/read"',
          '    respond 200 json=readDisk.result',
        ].join('\n'),
      );
      const test = validate(
        [
          'test name="Tool behavior" target="./files.kern"',
          '  it name="mocks tool effect boundary"',
          '    mock effect=readDisk returns={{"hello"}}',
          '    expect tool=readFile with={{({ filePath: "/data/a.txt" })}} returns={{"hello"}}',
        ].join('\n'),
      );
      expect(target).toHaveLength(0);
      expect(test).toHaveLength(0);
    });

    it('allows native mock call-count assertions', () => {
      const v = validate(
        [
          'test name="Effect behavior" target="./effects.kern"',
          '  it name="counts mocked effect calls"',
          '    mock effect=fetchUsers returns={{users}}',
          '    expect effect=fetchUsers returns={{users}}',
          '    expect mock=fetchUsers called=1',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native codegen assertions', () => {
      const v = validate(
        [
          'test name="Codegen" target="./source.kern"',
          '  it name="checks output"',
          '    expect codegen contains="function retry"',
          '    expect codegen notContains="function bad"',
          '    expect codegen matches="retry\\\\("',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native decompile and roundtrip assertions', () => {
      const v = validate(
        [
          'test name="Roundtrip" target="./source.kern"',
          '  it name="checks source regeneration"',
          '    expect decompile contains="param name=attempts"',
          '    expect decompile notContains="kind=const"',
          '    expect decompile matches="binding name=id"',
          '    expect roundtrip=true',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags native effect mocks without behavior', () => {
      const v = validate(
        ['test name="Effect behavior"', '  it name="mocks effect boundary"', '    mock effect=fetchUsers'].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'mock' requires either returns"))).toBe(true);
    });

    it('flags native effect mocks that combine returns and throws', () => {
      const v = validate(
        [
          'test name="Effect behavior"',
          '  it name="mocks effect boundary"',
          '    mock effect=fetchUsers returns={{[]}} throws=NetworkError',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'mock' must not combine returns"))).toBe(true);
    });

    it('flags incomplete native mock call-count assertions', () => {
      const missingCalled = validate(
        [
          'test name="Effect behavior"',
          '  it name="missing called"',
          '    mock effect=fetchUsers returns={{[]}}',
          '    expect mock=fetchUsers',
        ].join('\n'),
      );
      const missingMock = validate(
        ['test name="Effect behavior"', '  it name="missing mock"', '    expect called=1'].join('\n'),
      );
      expect(
        missingCalled.some((violation) => violation.message.includes('require both mock=<effect> and called=<count>')),
      ).toBe(true);
      expect(
        missingMock.some((violation) => violation.message.includes('require both mock=<effect> and called=<count>')),
      ).toBe(true);
    });

    it('flags empty native mock call counts', () => {
      const v = validate(
        [
          'test name="Effect behavior"',
          '  it name="empty called"',
          '    mock effect=fetchUsers returns={{[]}}',
          '    expect mock=fetchUsers called=',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('called=<non-negative integer>'))).toBe(true);
    });

    it('flags native mock call-count assertions with ignored result props', () => {
      const v = validate(
        [
          'test name="Effect behavior"',
          '  it name="ambiguous mock call"',
          '    mock effect=fetchUsers returns={{[]}}',
          '    expect mock=fetchUsers called=1 returns={{[]}}',
        ].join('\n'),
      );
      expect(
        v.some((violation) => violation.message.includes('mock call assertions cannot combine with runtime value')),
      ).toBe(true);
    });

    it('flags empty expect assertions', () => {
      const v = validate(['test name="Empty"', '  it name="does nothing"', '    expect'].join('\n'));
      expect(v.some((violation) => violation.message.includes("'expect' requires"))).toBe(true);
    });

    it('accepts positive native invariant assertions', () => {
      const v = validate(
        [
          'test name="Bad target" target="./bad.kern"',
          '  it name="detects broken source"',
          '    expect has=deriveCycles matches="cycle"',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags expect assertions that combine positive and negative invariants', () => {
      const v = validate(
        ['test name="Ambiguous"', '  it name="cannot be both"', '    expect no=deriveCycles has=deriveCycles'].join(
          '\n',
        ),
      );
      expect(
        v.some((violation) => violation.message.includes('cannot combine no=<invariant> and has=<invariant>')),
      ).toBe(true);
    });

    it('flags fixtures without a runtime value', () => {
      const v = validate(['test name="Fixture"', '  it name="missing value"', '    fixture name=order'].join('\n'));
      expect(v.some((violation) => violation.message.includes("'fixture' requires either value"))).toBe(true);
    });

    it('flags fixtures that combine value and expr', () => {
      const v = validate(
        [
          'test name="Fixture"',
          '  it name="ambiguous"',
          '    fixture name=order value={{({ id: "1" })}} expr={{({ id: "2" })}}',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'fixture' must not combine"))).toBe(true);
    });

    it('flags behavioral expect assertions that combine fn and derive', () => {
      const v = validate(
        ['test name="Behavior"', '  it name="ambiguous"', '    expect fn=total derive=total equals=3'].join('\n'),
      );
      expect(
        v.some((violation) =>
          violation.message.includes(
            'cannot combine fn=<name>, derive=<name>, route=<spec>, tool=<name>, effect=<name>, and mock=<name>',
          ),
        ),
      ).toBe(true);
    });

    it('flags behavioral expect assertions that combine runtime targets with expr', () => {
      const v = validate(
        ['test name="Behavior"', '  it name="ambiguous"', '    expect tool=readFile expr={{readFile()}} equals=3'].join(
          '\n',
        ),
      );
      expect(
        v.some((violation) =>
          violation.message.includes('cannot combine fn/derive/route/tool/effect/mock behavioral assertions'),
        ),
      ).toBe(true);
    });

    it('flags machine transition expect assertions without machine', () => {
      const v = validate(
        [
          'test name="Order"',
          '  it name="declares capture"',
          '    expect transition=capture from=confirmed to=paid',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('require machine=<name>'))).toBe(true);
    });

    it('flags mixed transition and reachability expect assertions', () => {
      const v = validate(
        [
          'test name="Order"',
          '  it name="mixes transition and reachability"',
          '    expect machine=Order transition=capture reaches=paid',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('cannot combine machine transition'))).toBe(true);
    });

    it('allows helper core nodes in mcp', () => {
      const v = validate(
        [
          'mcp name=HelperServer',
          '  import from="node:fs" names=readFileSync',
          '  const name=DEFAULT_GREETING value="hello"',
          '  fn name=formatGreeting params="name:string" returns=string',
          '    handler <<<return `${DEFAULT_GREETING}, ${name}`;>>>',
          '  tool name=greet',
          '    param name=name type=string required=true',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });
  });

  describe('complex valid nodes', () => {
    it('passes valid service', () => {
      const v = validate(
        [
          'service name=Cache implements=Storage',
          '  field name=data type="Map<string,any>" private=true',
          '  method name=get params="key:string" returns=any',
          '    handler <<<return this.data.get(key);>>>',
          '  constructor params="size:number"',
          '    handler <<<this.data = new Map();>>>',
          '  singleton name=cache',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('passes valid event', () => {
      const v = validate(['event name=AppEvent', '  type name="user:login"', '  type name="user:logout"'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('passes valid config', () => {
      const v = validate(
        [
          'config name=Settings',
          '  field name=port type=number default=3000',
          '  field name=host type=string default=localhost',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('passes valid action', () => {
      const v = validate(
        ['action name=notify params="to:string" returns=void idempotent=true', '  handler <<<await send(to);>>>'].join(
          '\n',
        ),
      );
      expect(v).toHaveLength(0);
    });
  });

  describe('nodes without schemas pass silently', () => {
    it('screen nodes have no schema and pass', () => {
      const v = validate('screen name=Home');
      expect(v).toHaveLength(0);
    });

    it('text nodes pass', () => {
      const v = validate('text value="hello"');
      expect(v).toHaveLength(0);
    });
  });

  describe('Pareto schema coverage — new schemas', () => {
    it('passes valid cli with command, arg, flag', () => {
      const v = validate(
        [
          'cli name=myapp version=1.0.0',
          '  command name=deploy description="Deploy"',
          '    arg name=target type=string required=true',
          '    flag name=dry-run alias=n type=boolean',
          '    handler <<<deploy(target)>>>',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags cli missing name', () => {
      const v = validate('cli version=1.0');
      expect(v.some((v) => v.message.includes("'cli' requires prop 'name'"))).toBe(true);
    });

    it('flags command missing name', () => {
      const v = validate('command description="test"');
      expect(v.some((v) => v.message.includes("'command' requires prop 'name'"))).toBe(true);
    });

    it('flags spawn missing binary', () => {
      const v = validate('spawn args="[]"');
      expect(v.some((v) => v.message.includes("'spawn' requires prop 'binary'"))).toBe(true);
    });

    it('passes valid spawn', () => {
      const v = validate('spawn binary=ffmpeg args="[-i,input]" timeout=30');
      expect(v).toHaveLength(0);
    });

    it('flags fetch missing name', () => {
      const v = validate('fetch url="/api"');
      expect(v.some((v) => v.message.includes("'fetch' requires prop 'name'"))).toBe(true);
    });

    it('allows fetch without url when a handler body supplies the loader (GAP-009)', () => {
      const v = validate('fetch name=data\n  handler <<<return await loadRows()>>>');
      expect(v.some((violation) => violation.message.includes("'fetch' requires prop 'url'"))).toBe(false);
    });

    it('passes valid memo', () => {
      const v = validate('memo name=filtered deps="items"\n  handler <<<return items>>>');
      expect(v).toHaveLength(0);
    });

    it('flags memo missing name', () => {
      const v = validate('memo deps="items"');
      expect(v.some((v) => v.message.includes("'memo' requires prop 'name'"))).toBe(true);
    });

    it('passes valid column', () => {
      const v = validate('column name=email type=string unique=true');
      expect(v).toHaveLength(0);
    });

    it('flags column missing name', () => {
      const v = validate('column type=string');
      expect(v.some((v) => v.message.includes("'column' requires prop 'name'"))).toBe(true);
    });

    it('flags redirect missing to', () => {
      const v = validate('redirect');
      expect(v.some((v) => v.message.includes("'redirect' requires prop 'to'"))).toBe(true);
    });

    it('flags env missing name', () => {
      const v = validate('env required=true');
      expect(v.some((v) => v.message.includes("'env' requires prop 'name'"))).toBe(true);
    });

    it('flags option missing value', () => {
      const v = validate('option label="Admin"');
      expect(v.some((v) => v.message.includes("'option' requires prop 'value'"))).toBe(true);
    });

    it('flags context missing source', () => {
      const v = validate('context name=theme');
      expect(v.some((v) => v.message.includes("'context' requires prop 'source'"))).toBe(true);
    });

    it('passes valid invalidate', () => {
      const v = validate('invalidate on=userUpdate tags="user"');
      expect(v).toHaveLength(0);
    });

    it('flags invalidate missing on', () => {
      const v = validate('invalidate tags="user"');
      expect(v.some((v) => v.message.includes("'invalidate' requires prop 'on'"))).toBe(true);
    });
  });
});
