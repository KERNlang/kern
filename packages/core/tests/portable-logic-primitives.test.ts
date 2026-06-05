import {
  lookupPortableLogicPrimitive,
  PORTABLE_LOGIC_PRIMITIVE_IDS,
  type PortableLogicPrimitiveId,
  portableLogicSupportForTarget,
  validatePortableLogicPrimitiveRegistry,
} from '../src/codegen/portable-logic-primitives.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { splitPortableExpressionList } from '../src/portable-expression-list.js';
import { parsePortablePredicateProp, validatePortablePredicateAST } from '../src/portable-predicate.js';
import { validateSchema } from '../src/schema.js';

describe('portable logic primitive registry', () => {
  test('registers the Job-central R1 primitive surface explicitly', () => {
    expect(PORTABLE_LOGIC_PRIMITIVE_IDS).toEqual([
      'collection.has',
      'collection.count',
      'collection.filter',
      'collection.uniqueBy',
      'collection.groupBy',
      'collection.partition',
      'collection.indexBy',
      'collection.countBy',
      'logic.firstTruthy',
      'time.epochMs',
      'logic.not',
      'number.clamp',
      'object.keys',
      'object.values',
      'object.entries',
      'object.merge',
      'object.omit',
      'object.pick',
      'string.trim',
      'string.split',
      'string.replaceFirst',
      'string.replaceAll',
    ]);
  });

  test('reports per-target support for the current parity slice', () => {
    expect(portableLogicSupportForTarget('collection.has', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.count', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.filter', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.uniqueBy', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.groupBy', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.partition', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.indexBy', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('collection.countBy', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('logic.firstTruthy', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('time.epochMs', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('logic.not', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('number.clamp', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('object.entries', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('string.split', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('string.replaceFirst', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('time.epochMs', 'go')).toBe('unsupported');
    expect(portableLogicSupportForTarget('string.replaceAll', 'go')).toBe('unsupported');
  });

  test('keyed collection reshape slice has matching target support', () => {
    const keyedCollectionPrimitives: PortableLogicPrimitiveId[] = [
      'collection.uniqueBy',
      'collection.groupBy',
      'collection.partition',
      'collection.indexBy',
      'collection.countBy',
    ];
    for (const id of keyedCollectionPrimitives) {
      expect(portableLogicSupportForTarget(id, 'ts')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'python')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'go')).toBe('unsupported');
    }
  });

  test('keyed collection reshape nodes are admitted as direct route children only', () => {
    const directRoute = [
      'server name=API',
      '  route method=post path=/api/t',
      '    filter name=active_adults in=users predicate={{ {and: [{eq: ["active", true]}, {gte: ["age", 18]}]} }}',
      '    uniqueBy name=distinct in=users by="item.id"',
      '    groupBy name=by_type in=users by="item.type"',
      '    partition pass=active fail=inactive in=users where="item.active"',
      '    indexBy name=by_id in=users by="item.id"',
      '    countBy name=counts in=users by="item.type"',
      '    objectMerge name=merged sources="body.user, body.override"',
      `    objectPick name=public_user in=merged keys="['id', 'missing']"`,
      `    objectOmit name=safe_user in=merged keys="['password']"`,
      '    respond 200 json=counts',
    ].join('\n');
    const direct = parseDocumentWithDiagnostics(directRoute);
    expect(direct.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(validateSchema(direct.root).filter((v) => /does not allow child type/.test(v.message))).toEqual([]);

    const streamRoute = [
      'server name=API',
      '  route method=get path=/api/t',
      '    stream',
      '      uniqueBy name=distinct in=users by="item.id"',
    ].join('\n');
    const stream = parseDocumentWithDiagnostics(streamRoute);
    expect(
      validateSchema(stream.root).some((v) => /'stream' does not allow child type 'uniqueBy'/.test(v.message)),
    ).toBe(true);
  });

  test('portable expression list splitter rejects empty source expressions', () => {
    expect(() => splitPortableExpressionList('base,,overrides', 'objectMerge sources=')).toThrow(/empty expression/);
    expect(() => splitPortableExpressionList('base, overrides,', 'objectMerge sources=')).toThrow(/empty expression/);
    expect(splitPortableExpressionList("base, { label: 'a,b' }, overrides", 'objectMerge sources=')).toEqual([
      'base',
      "{ label: 'a,b' }",
      'overrides',
    ]);
  });

  test('filter route child requires exactly one predicate form', () => {
    const missing = parseDocumentWithDiagnostics(
      ['server name=API', '  route method=post path=/api/t', '    filter name=active in=users'].join('\n'),
    );
    expect(validateSchema(missing.root).some((v) => /requires either where= or predicate/.test(v.message))).toBe(true);

    const combined = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    filter name=active in=users where="item.active" predicate={{ {eq: ["active", true]} }}',
      ].join('\n'),
    );
    expect(validateSchema(combined.root).some((v) => /cannot combine where= and predicate/.test(v.message))).toBe(true);
  });

  test('route predicate literals are validated at schema time', () => {
    const invalid = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    filter name=bad in=users predicate={{ {and: [{lt: ["age", "18"]}, {matches: ["role", "admin"]}, {eq: ["profile..name", "x"]}, {eq: ["items.01.name", "x"]}]} }}',
      ].join('\n'),
    );
    const messages = validateSchema(invalid.root).map((v) => v.message);
    expect(messages.some((m) => /lt expects a non-boolean number/.test(m))).toBe(true);
    expect(messages.some((m) => /unsupported operator 'matches'/.test(m))).toBe(true);
    expect(messages.some((m) => /must not contain empty segments/.test(m))).toBe(true);
    expect(messages.some((m) => /must use canonical decimal indexes/.test(m))).toBe(true);

    const malformed = parseDocumentWithDiagnostics(
      ['server name=API', '  route method=post path=/api/t', '    filter name=bad in=users predicate={{ "bad" }}'].join(
        '\n',
      ),
    );
    expect(validateSchema(malformed.root).some((v) => /predicate must be a valid object literal/.test(v.message))).toBe(
      true,
    );
  });

  test('route predicate parser accepts JS-like literal strings without regex corruption', () => {
    const valid = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    filter name=notes in=items predicate={{ {and: [{eq: ["note", "{bad: text}, [ok]"]}, {neq: [\'label\', \'value: still text\']},]} }}',
        '    count name=note_count in=items predicate="{and: [{eq: [\\"note\\", \\"{bad: text}, [ok]\\"]},]}"',
      ].join('\n'),
    );
    const messages = validateSchema(valid.root).map((v) => v.message);
    expect(messages.filter((m) => /predicate/.test(m))).toEqual([]);
  });

  test('route predicate parser accepts or/not boolean composition', () => {
    const valid = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    filter name=eligible in=users predicate={{ {and: [{or: [{eq: ["role", "admin"]}, {eq: ["role", "staff"]}]}, {not: {eq: ["status", "banned"]} }]} }}',
        '    count name=eligible_count in=users predicate="{or: [{not: {eq: [\\"missing\\", null]}}, {eq: [\\"role\\", \\"admin\\"]}]}"',
        '    respond 200 json=eligible_count',
      ].join('\n'),
    );
    const messages = validateSchema(valid.root).map((v) => v.message);
    expect(messages.filter((m) => /predicate/.test(m))).toEqual([]);
  });

  test('route predicate parser rejects malformed or/not composition', () => {
    expect(validatePortablePredicateAST({ or: [] })).toContain('or expects a non-empty predicate array');
    expect(validatePortablePredicateAST({ not: [{ eq: ['active', true] }] })).toContain(
      'not expects a predicate object',
    );
    expect(validatePortablePredicateAST({ not: {} })).toContain('predicate objects must contain exactly one operator');

    const invalid = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    filter name=bad in=users predicate={{ {and: [{or: []}, {not: [{eq: ["active", true]}]}]} }}',
      ].join('\n'),
    );
    const messages = validateSchema(invalid.root).map((v) => v.message);
    expect(messages.some((m) => /or expects a non-empty predicate array/.test(m))).toBe(true);
    expect(messages.some((m) => /not expects a predicate object/.test(m))).toBe(true);
  });

  test('route predicate parser accepts richer leaf predicates', () => {
    const valid = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    filter name=eligible in=users predicate={{ {and: [{exists: "profile.tags.0"}, {in: ["role", ["admin", "staff"]]}, {nin: ["status", ["banned"]]}, {contains: ["profile.tags", "vip"]}, {contains: ["name", "A"]}, {startsWith: ["email", "a"]}, {endsWith: ["email", ".com"]}]} }}',
        '    respond 200 json=eligible',
      ].join('\n'),
    );
    const messages = validateSchema(valid.root).map((v) => v.message);
    expect(messages.filter((m) => /predicate/.test(m))).toEqual([]);
  });

  test('route predicate parser rejects malformed richer leaf predicates', () => {
    expect(validatePortablePredicateAST({ exists: 'profile.email' })).toEqual([]);
    expect(validatePortablePredicateAST({ exists: ['profile.email'] })).toContain(
      'exists expects a predicate path string',
    );
    expect(validatePortablePredicateAST({ in: ['role', []] })).toContain('in expects [path, non-empty scalar array]');
    expect(validatePortablePredicateAST({ nin: ['role', [{}]] })).toContain(
      'nin expects [path, non-empty scalar array]',
    );
    expect(validatePortablePredicateAST({ contains: ['tags', {}] })).toContain(
      'contains expects [path, scalar expected]',
    );
    expect(validatePortablePredicateAST({ startsWith: ['email', 1] })).toContain(
      'startsWith expects [path, string expected]',
    );
    expect(validatePortablePredicateAST({ endsWith: ['email', null] })).toContain(
      'endsWith expects [path, string expected]',
    );
  });

  test('portable predicate parser handles escapes and rejects dynamic values', () => {
    const parsed = parsePortablePredicateProp('{eq: ["note", "\\u0078"]}');
    expect(parsed.ok).toBe(true);
    expect(((parsed.value as any).eq as unknown[])[1]).toBe('x');

    expect(parsePortablePredicateProp('{eq: ["age", minAge]}').ok).toBe(false);
    expect(validatePortablePredicateAST({ gt: ['age', Number.POSITIVE_INFINITY] })).toContain(
      'gt expects a non-boolean number',
    );
  });

  test('count route child accepts predicate but not where plus predicate', () => {
    const valid = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    count name=eligible_count in=users predicate={{ {and: [{lt: ["age", 30]}, {lte: ["score", 10]}]} }}',
        '    respond 200 json=eligible_count',
      ].join('\n'),
    );
    expect(validateSchema(valid.root).filter((v) => v.nodeType === 'count')).toEqual([]);

    const combined = parseDocumentWithDiagnostics(
      [
        'server name=API',
        '  route method=post path=/api/t',
        '    count name=eligible_count in=users where="item.active" predicate={{ {eq: ["active", true]} }}',
      ].join('\n'),
    );
    expect(
      validateSchema(combined.root).some((v) => /'count' cannot combine where= and predicate/.test(v.message)),
    ).toBe(true);

    const outsideRoute = parseDocumentWithDiagnostics(
      ['server name=API', '  count name=eligible_count in=users predicate={{ {eq: ["active", true]} }}'].join('\n'),
    );
    expect(
      validateSchema(outsideRoute.root).some((v) =>
        /'count predicate=\{\{\.\.\.\}\}' is supported only/.test(v.message),
      ),
    ).toBe(true);
  });

  test('object parity slice has matching target support', () => {
    const objectPrimitives: PortableLogicPrimitiveId[] = [
      'object.keys',
      'object.values',
      'object.entries',
      'object.merge',
      'object.omit',
      'object.pick',
    ];
    for (const id of objectPrimitives) {
      expect(portableLogicSupportForTarget(id, 'ts')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'python')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'go')).toBe('unsupported');
    }
  });

  test('string parity slice has matching target support', () => {
    const stringPrimitives: PortableLogicPrimitiveId[] = [
      'string.trim',
      'string.split',
      'string.replaceFirst',
      'string.replaceAll',
    ];
    for (const id of stringPrimitives) {
      expect(portableLogicSupportForTarget(id, 'ts')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'python')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'go')).toBe('unsupported');
    }
  });

  test('lookup returns null for unknown primitive ids', () => {
    expect(lookupPortableLogicPrimitive('collection.has')?.purity).toBe('pure');
    expect(lookupPortableLogicPrimitive('collection.count')?.hostPatterns).toContain('xs.filter(x => pred).length');
    expect(lookupPortableLogicPrimitive('collection.filter')?.hostPatterns).toContain('xs.filter(x => pred)');
    expect(lookupPortableLogicPrimitive('collection.uniqueBy')?.portabilityNotes.join(' ')).toContain('first-wins');
    expect(lookupPortableLogicPrimitive('collection.partition')?.portabilityNotes.join(' ')).toContain('predicate');
    expect(lookupPortableLogicPrimitive('collection.indexBy')?.portabilityNotes.join(' ')).toContain('last-write-wins');
    expect(lookupPortableLogicPrimitive('collection.countBy')?.portabilityNotes.join(' ')).toContain('integers');
    const firstTruthy = lookupPortableLogicPrimitive('logic.firstTruthy');
    expect(firstTruthy?.hostPatterns).toContain('a || b || c');
    expect(firstTruthy?.portabilityNotes.join(' ')).toContain('empty collections are target-specific');
    expect(lookupPortableLogicPrimitive('number.clamp')?.hostPatterns).toContain('Math.max(lo, Math.min(hi, value))');
    expect(lookupPortableLogicPrimitive('number.clamp')?.intent).toBe('semantic-gap');
    expect(lookupPortableLogicPrimitive('object.keys')?.hostPatterns).toContain('Object.keys(obj)');
    expect(lookupPortableLogicPrimitive('object.values')?.hostPatterns).toContain('Object.values(obj)');
    expect(lookupPortableLogicPrimitive('object.entries')?.hostPatterns).toContain('Object.entries(obj)');
    expect(lookupPortableLogicPrimitive('object.merge')?.hostPatterns).toContain('Object.assign({}, a, b)');
    expect(lookupPortableLogicPrimitive('string.trim')?.hostPatterns).toContain('value.trim()');
    expect(lookupPortableLogicPrimitive('string.split')?.hostPatterns).toContain('value.split(separator)');
    expect(lookupPortableLogicPrimitive('string.split')?.hostPatterns).toContain('value.split(separator, limit)');
    expect(lookupPortableLogicPrimitive('string.replaceFirst')?.hostPatterns).toContain(
      'value.replace(search, replacement)',
    );
    expect(lookupPortableLogicPrimitive('string.replaceAll')?.hostPatterns).toContain(
      'value.replaceAll(search, replacement)',
    );
    expect(lookupPortableLogicPrimitive('host.randomThing')).toBeNull();
  });

  test('registry validation rejects duplicate operator and weak metadata shapes', () => {
    const valid = lookupPortableLogicPrimitive('number.clamp');
    expect(valid).not.toBeNull();

    expect(() =>
      validatePortableLogicPrimitiveRegistry({
        'logic.nullishCoalesce': {
          ...valid!,
          id: 'logic.nullishCoalesce' as PortableLogicPrimitiveId,
        },
      }),
    ).toThrow(/duplicates existing language nullish\/coalesce syntax/);

    expect(() =>
      validatePortableLogicPrimitiveRegistry({
        'number.bad': {
          ...valid!,
          id: 'number.bad' as PortableLogicPrimitiveId,
          portabilityNotes: ['one', 'two'],
        },
      }),
    ).toThrow(/exactly one portability note/);

    expect(() =>
      validatePortableLogicPrimitiveRegistry({
        'logic.operator': {
          ...valid!,
          id: 'logic.operator' as PortableLogicPrimitiveId,
          intent: 'language-operator',
        },
      }),
    ).toThrow(/needs an operator rationale/);

    expect(() =>
      validatePortableLogicPrimitiveRegistry({
        'string.coalesceAtStart': {
          ...valid!,
          id: 'string.coalesceAtStart' as PortableLogicPrimitiveId,
        },
      }),
    ).not.toThrow();
  });

  test('does not register a named nullish/coalesce primitive', () => {
    // The language already has `??`; this guards against adding a duplicate registry API by accident.
    expect(PORTABLE_LOGIC_PRIMITIVE_IDS.some((id) => id.includes('nullish') || id.includes('coalesce'))).toBe(false);
    expect(lookupPortableLogicPrimitive('logic.nullishCoalesce')).toBeNull();
  });
});
