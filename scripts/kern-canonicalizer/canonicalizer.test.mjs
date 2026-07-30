import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { VALID_FIXTURES } from './fixtures.mjs';
import { validateCanonicalizerPolicy } from './policy.mjs';

const mainSource = readFileSync(new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url), 'utf8');
const helperSource = readFileSync(
  new URL('../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', import.meta.url),
  'utf8',
);
const statementSource = readFileSync(
  new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url),
  'utf8',
);
const source = `${helperSource}${statementSource}${mainSource}`;
const policyUrl = new URL('./policy.json', import.meta.url);

function topLevelFunctionSource(member, name) {
  const marker = new RegExp(`^fn name=${name}(?: |$)`, 'mu').exec(member);
  const start = marker?.index ?? -1;
  assert.ok(start >= 0, `missing top-level function ${name}`);
  const next = member.indexOf('\nfn name=', start + marker[0].length);
  return member.slice(start, next < 0 ? undefined : next);
}

test('the KERN canonicalizer members are parseable, bounded, and contain the semantic source decisions', () => {
  for (const [name, member] of [
    ['expression helpers', helperSource],
    ['statement helpers', statementSource],
    ['main', mainSource],
  ]) {
    const parsedMember = parseDocumentWithDiagnostics(member);
    assert.notEqual(parsedMember.partial, true, name);
    assert.deepEqual(
      parsedMember.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      [],
      name,
    );
    assert.ok(member.split('\n').length - 1 < 500, `${name} hand-written KERN source must stay below 500 lines`);
  }
  const parsed = parseDocumentWithDiagnostics(source);
  assert.notEqual(parsed.partial, true);
  assert.deepEqual(
    parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [],
  );
  for (const owned of ['fn name=', 'param name=', 'handler lang=', 'return value=', 'quotesource', 'typesource']) {
    assert.ok(source.includes(owned), `missing KERN-owned source decision ${owned}`);
  }
});

test('one-based scalar table lookup delegates to strict List.index without a scan loop', () => {
  const stringAt = /fn name=stringat[\s\S]*?(?=\nfn name=numberat)/u.exec(helperSource)?.[0];
  const numberAt = /fn name=numberat[\s\S]*?(?=\nfn name=propid)/u.exec(helperSource)?.[0];
  assert.ok(stringAt);
  assert.ok(numberAt);
  assert.equal(stringAt.includes('for name='), false);
  assert.equal(numberAt.includes('for name='), false);
  assert.ok(stringAt.includes('List.index(values, id - 1) ?? \\\"\\\"'));
  assert.ok(numberAt.includes('List.index(values, id - 1) ?? -1'));
});

test('M4.104 statement emission sparsely quotes only previously validated canonical sources', () => {
  const validatedQuote = topLevelFunctionSource(helperSource, 'quotesource');
  const statementEmitter = topLevelFunctionSource(statementSource, 'emitstatement');
  assert.equal((validatedQuote.match(/^\s+for\b/gmu) ?? []).length, 1);
  assert.equal(validatedQuote.includes('quotesource('), false);
  assert.equal((validatedQuote.match(/^\s+while\b/gmu) ?? []).length, 1);
  assert.equal((validatedQuote.match(/Text\.indexOf\(/gu) ?? []).length, 6);
  assert.equal((validatedQuote.match(/Text\.indexOf\(value,/gu) ?? []).length, 1);
  assert.equal((validatedQuote.match(/Text\.slice\(/gu) ?? []).length, 2);
  assert.equal((statementEmitter.match(/quotesource\(/gu) ?? []).length, 10);
  assert.equal((statementEmitter.match(/, true\)/gu) ?? []).length, 10);
});

test('M4.104 child lookup starts at the authenticated parent row and returns immediately', () => {
  const childAt = topLevelFunctionSource(helperSource, 'childat');
  assert.ok(childAt.includes('for name=i from="parent" to="nodeParent.length"'));
  assert.ok(childAt.includes('return value="i + 1"'));
  assert.equal(childAt.includes('let name=result'), false);
});

test('M4.106 statement access delegates to one memoizable authenticated fact pass', () => {
  const statementTableFacts = topLevelFunctionSource(helperSource, 'statementtablefacts');
  const statementFacts = topLevelFunctionSource(helperSource, 'statementfacts');
  assert.equal((statementTableFacts.match(/^\s+for\b/gmu) ?? []).length, 2);
  assert.ok(statementTableFacts.includes('if cond="nodeParent.length > rowCount"'));
  assert.ok(statementTableFacts.includes('for name=i from=0 to="rowCount"'));
  assert.ok(statementTableFacts.includes('let name=nodeCount value="nodeParent.length + 1"'));
  assert.ok(statementTableFacts.includes('for name=node from=0 to="nodeCount"'));
  assert.ok(statementTableFacts.includes('return value="facts"'));
  for (const field of ['valueIds', 'nameIds', 'targetIds', 'condIds', 'fromIds', 'toIds']) {
    assert.ok(
      statementTableFacts.includes(`if cond="Map.has(${field}, nodeKey)"`),
      `${field} must retain duplicate-property rejection`,
    );
    assert.ok(
      statementTableFacts.includes(`Map.set(${field}, String(propNode[i]), -1)`),
      `${field} duplicate must retain the -1 sentinel`,
    );
  }
  assert.equal((statementFacts.match(/^\s+for\b/gmu) ?? []).length, 0);
  assert.ok(statementFacts.includes('statementtablefacts(nodeParent, propNode, propKey, propValue)'));
  assert.equal((statementFacts.match(/numberat\(/gu) ?? []).length, 8);
  assert.ok(statementFacts.includes(
    'return value="[childCount, propertyCount, valueId, nameId, targetId, condId, fromId, toId]"',
  ));

  for (const owner of ['validstatementlist', 'validstatement', 'emitstatementlist', 'emitstatement']) {
    const ownerSource = topLevelFunctionSource(statementSource, owner);
    assert.ok(ownerSource.includes('statementfacts('), `${owner} must use the shared projected facts`);
    assert.equal(ownerSource.includes('propid('), false, `${owner} must not rescan properties by key`);
    assert.equal(ownerSource.includes('propcount('), false, `${owner} must not recount properties`);
    assert.equal(ownerSource.includes('childcount('), false, `${owner} must not recount children`);
  }
  const validation = topLevelFunctionSource(statementSource, 'validstatement');
  assert.ok(validation.includes('let name=kind value="stringat(id, nodeKind)"'));
  assert.ok(validation.includes('if cond="kind == \\"return\\""'));
});

test('M4.117 type projection delegates to one memoizable authenticated fact pass', () => {
  const typeSource = topLevelFunctionSource(mainSource, 'typesource');
  const typeFields = topLevelFunctionSource(helperSource, 'typefields');
  const typeFieldTableFacts = topLevelFunctionSource(helperSource, 'typefieldtablefacts');
  assert.equal((typeSource.match(/^\s+for\b/gmu) ?? []).length, 0);
  assert.equal(typeSource.includes('valuechildcount('), false);
  assert.equal(typeSource.includes('recordfield('), false);
  assert.ok(typeSource.includes('typefields(id, valueParent, valueRole)'));
  assert.equal((typeFieldTableFacts.match(/^\s+for\b/gmu) ?? []).length, 2);
  assert.ok(typeFieldTableFacts.includes('for name=i from=0 to="valueParent.length"'));
  assert.ok(typeFieldTableFacts.includes('let name=parentCount value="valueParent.length + 1"'));
  assert.ok(typeFieldTableFacts.includes('for name=parent from=0 to="parentCount"'));
  assert.ok(typeFieldTableFacts.includes('Map.set(kindIds, String(valueParent[i]), -1)'));
  assert.ok(typeFieldTableFacts.includes('Map.set(elementIds, String(valueParent[i]), -1)'));
  assert.ok(typeFieldTableFacts.includes('do value="facts.push(count)"'));
  assert.ok(typeFieldTableFacts.includes('do value="facts.push(kindId)"'));
  assert.ok(typeFieldTableFacts.includes('do value="facts.push(elementId)"'));
  assert.equal((typeFields.match(/^\s+for\b/gmu) ?? []).length, 0);
  assert.equal((typeFields.match(/valuechildcount\(/gu) ?? []).length, 1);
  assert.equal((typeFields.match(/recordfield\(/gu) ?? []).length, 2);
  assert.ok(typeFields.includes('if cond="parent < 0 || parent > valueParent.length"'));
  assert.ok(typeFields.includes(
    'return value="[outsideCount, outsideKindId, outsideElementId]"',
  ));
  assert.ok(typeFields.includes('typefieldtablefacts(valueParent, valueRole)'));
  assert.equal((typeFields.match(/numberat\(/gu) ?? []).length, 3);
  assert.ok(typeFields.includes('if cond="kindId < 0 || elementId < 0"'));
  assert.ok(typeFields.includes('return value="[-1, -1, -1]"'));
  assert.ok(typeFields.includes('return value="[count, kindId, elementId]"'));
});

test('M4.89 expression projection delegates to one memoizable table-wide helper', () => {
  const expressionSource = topLevelFunctionSource(mainSource, 'exprsource');
  const expressionSources = topLevelFunctionSource(mainSource, 'expressionsources');
  assert.equal((expressionSource.match(/^\s+for\b/gmu) ?? []).length, 0);
  assert.ok(expressionSource.includes(
    'expressionsources(valueTag, valueParent, valueRole, valueOrder, valueText, valueBool)',
  ));
  assert.ok(expressionSource.includes('List.index(sources, valueTag.length - id) ?? \\"\\"'));
  assert.equal((expressionSources.match(/to="valueParent\.length"/gu) ?? []).length, 1);
  assert.equal((expressionSources.match(/to="valueTag\.length"/gu) ?? []).length, 1);
  assert.ok(expressionSources.includes('do value="ordered.push(source)"'));
  assert.ok(expressionSources.includes('do value="Map.set(sources, String(current), source)"'));
});

test('M4.129 assignment-target kind reuses the authenticated type-field projection', () => {
  const statementValidation = topLevelFunctionSource(statementSource, 'validstatement');
  assert.ok(statementValidation.includes(
    'let name=targetFields value="typefields(targetId, valueParent, valueRole)"',
  ));
  assert.ok(statementValidation.includes('let name=targetKindId value="targetFields[1]"'));
  assert.ok(statementValidation.includes('exprsource(targetId,'));
  assert.equal(statementValidation.includes('recordfield('), false);
});

test('M4.93 table validation delegates to three independent boolean linear-pass helpers', () => {
  const tableOwner = topLevelFunctionSource(mainSource, 'tablesok');
  const nodeFacts = topLevelFunctionSource(mainSource, 'nodetablesok');
  const propertyFacts = topLevelFunctionSource(mainSource, 'propertyfacts');
  const valueFacts = topLevelFunctionSource(mainSource, 'valuefacts');
  assert.ok(tableOwner.includes('nodetablesok(nodeKind, nodeParent, nodeOrder)'));
  assert.ok(tableOwner.includes('propertyfacts(nodeKind, propNode, propKey, propValue, valueTag)'));
  assert.ok(tableOwner.includes(
    'valuefacts(propValue, valueTag, valueParent, valueRole, valueOrder, valueText, valueBool)',
  ));
  assert.equal((tableOwner.match(/^\s+for\b/gmu) ?? []).length, 0);
  for (const helper of [nodeFacts, propertyFacts]) {
    assert.equal((helper.match(/^\s+for\b/gmu) ?? []).length, 1);
    assert.equal(helper.includes('returns=object'), false);
  }
  assert.equal((valueFacts.match(/^\s+for\b/gmu) ?? []).length, 2);
  assert.ok(propertyFacts.includes('returns=boolean'));
  assert.ok(valueFacts.includes('returns=boolean'));
  assert.equal(propertyFacts.includes('ownedValues +'), false);
  assert.equal(valueFacts.includes('childParents +'), false);
  assert.equal(tableOwner.includes('Text.indexOf('), false);
  assert.equal(nodeFacts.includes('nodeCheck'), false);
  assert.equal(tableOwner.includes('validinteger('), false);
});

test('M4.98 authenticates property order before bounded lookup early exits', () => {
  const propertyFacts = topLevelFunctionSource(mainSource, 'propertyfacts');
  const propertyId = topLevelFunctionSource(helperSource, 'propid');
  const propertyCount = topLevelFunctionSource(helperSource, 'propcount');
  assert.ok(propertyFacts.includes(
    'propertyIndex > 0 && propNode[propertyIndex] < propNode[propertyIndex - 1]',
  ));
  assert.ok(propertyId.includes('if cond="propNode[i] > node"'));
  assert.ok(propertyId.includes('return value="result"'));
  assert.ok(propertyId.startsWith('fn name=propid returns=number export=false'));
  assert.ok(propertyCount.includes('if cond="propNode[i] > node"'));
  assert.ok(propertyCount.includes('return value="count"'));
  assert.ok(propertyCount.startsWith('fn name=propcount returns=number export=false'));
});

test('conditional validation and emission stay in the KERN statement member', () => {
  for (const owned of ['validstatementlist', 'validstatement', 'emitstatementlist', 'emitstatement']) {
    assert.ok(statementSource.includes(`fn name=${owned}`), `missing KERN-owned conditional helper ${owned}`);
    assert.equal(
      [...source.matchAll(new RegExp(`^fn name=${owned}\\b`, 'gmu'))].length,
      1,
      `conditional helper ${owned} must have exactly one definition in the executable composition`,
    );
  }
  assert.ok(mainSource.includes('validstatementlist'));
  assert.ok(mainSource.includes('emitstatementlist'));
});

test('counted-iteration validation and emission stay in the KERN statement member', () => {
  const validationStart = statementSource.indexOf('if cond="kind == \\"for\\""');
  const validationEnd = statementSource.indexOf('\nfn name=emitstatementlist', validationStart);
  assert.ok(validationStart >= 0 && validationEnd > validationStart, 'missing KERN-owned for validation branch');
  const validationBranch = statementSource.slice(validationStart, validationEnd);
  for (const [property, index] of [['from', 6], ['name', 3], ['to', 7]]) {
    assert.ok(
      validationBranch.includes(`let name=${property}Id value="facts[${index}]"`),
      `for validation omitted ${property}`,
    );
  }
  assert.ok(validationBranch.includes('facts[1] != 3'), 'for must reject step and future properties');
  assert.ok(validationBranch.includes('!valididentifier(name)'), 'for names must remain identifier-shaped');
  assert.ok(validationBranch.includes('Text.indexOf(name, \\"$\\") >= 0'), 'for names must remain cross-target');
  assert.ok(validationBranch.includes('validstatementlist(id'), 'for bodies must validate recursively');

  const emissionStart = statementSource.indexOf('if cond="kind == \\"for\\""', validationEnd);
  const emissionEnd = statementSource.indexOf('let name=children', emissionStart);
  assert.ok(emissionStart >= 0 && emissionEnd > emissionStart, 'missing KERN-owned for emission branch');
  const emissionBranch = statementSource.slice(emissionStart, emissionEnd);
  for (const [property, index] of [['from', 6], ['name', 3], ['to', 7]]) {
    assert.ok(
      emissionBranch.includes(`let name=${property}Id value="facts[${index}]"`),
      `for emission omitted ${property}`,
    );
  }
  assert.ok(emissionBranch.includes('quotesource(fromExpression, true)'), 'for emission must quote validated canonical from source');
  assert.ok(emissionBranch.includes('quotesource(toExpression, true)'), 'for emission must quote validated canonical to source');
});

test('M4.139 valued throw validation and emission stay bounded in the KERN statement member', () => {
  const validation = topLevelFunctionSource(statementSource, 'validstatement');
  const emission = topLevelFunctionSource(statementSource, 'emitstatement');
  const validationStart = validation.indexOf('if cond="kind == \\"throw\\""');
  const emissionStart = emission.indexOf('if cond="kind == \\"throw\\""');
  assert.ok(validationStart >= 0, 'missing KERN-owned throw validation branch');
  assert.ok(emissionStart >= 0, 'missing KERN-owned throw emission branch');
  const validationBranch = validation.slice(
    validationStart,
    validation.indexOf('\n    if cond=', validationStart + 1),
  );
  const emissionBranch = emission.slice(
    emissionStart,
    emission.indexOf('\n    if cond=', emissionStart + 1),
  );
  assert.ok(validationBranch.includes('facts[0] != 0'), 'throw must remain a leaf');
  assert.ok(validationBranch.includes('valueId <= 0 || facts[1] != 1'));
  assert.ok(validationBranch.includes('exprsource(valueId,'));
  assert.ok(emissionBranch.includes('throw value='));
  assert.ok(emissionBranch.includes('quotesource(expression, true)'));
  assert.ok(emissionBranch.includes('return value="out"'));
});

test('binding validation and emission stay in the KERN statement member', () => {
  const validationEnd = statementSource.indexOf('\nfn name=emitstatementlist');
  const validationSource = statementSource.slice(0, validationEnd);
  const emissionSource = statementSource.slice(validationEnd);
  for (const kind of ['let', 'assign']) {
    assert.ok(validationSource.includes(`if cond="kind == \\"${kind}\\""`), `missing KERN-owned ${kind} validation`);
    assert.ok(emissionSource.includes(`if cond="kind == \\"${kind}\\""`), `missing KERN-owned ${kind} emission`);
  }
  for (const [property, index] of [['name', 3], ['value', 2]]) {
    assert.ok(
      validationSource.includes(`let name=${property}Id value="facts[${index}]"`),
      `let validation omitted ${property}`,
    );
  }
  for (const [property, index] of [['target', 4], ['value', 2]]) {
    assert.ok(
      validationSource.includes(`let name=${property}Id value="facts[${index}]"`),
      `assign validation omitted ${property}`,
    );
  }
  assert.ok(validationSource.includes('facts[1] != 2'), 'bindings must reject optional metadata');
  assert.ok(validationSource.includes('structuralname(stringat(nameId, valueText))'), 'let names must retain structural identifier ownership');
  for (const targetKind of ['identifier', 'member', 'index']) {
    assert.ok(
      validationSource.includes(`targetKind != \\"${targetKind}\\"`),
      `assignment target validation omitted ${targetKind}`,
    );
  }
  assert.ok(validationSource.includes('typefields(targetId'), 'assignment targets need authenticated kind projection');
  assert.ok(validationSource.includes('exprsource(targetId'), 'assignment targets need recursive expression validation');
  assert.equal(validationSource.includes('recordfield('), false, 'assignment validation must not rescan value rows');
  assert.ok(emissionSource.includes('let name=targetExpression'), 'binding emission must canonicalize targets');
  assert.ok(emissionSource.includes('let name=valueExpression'), 'binding emission must canonicalize values');
  assert.ok(emissionSource.includes('quotesource(targetExpression, true)'), 'binding emission must quote validated canonical targets');
  assert.ok(emissionSource.includes('quotesource(valueExpression, true)'), 'binding emission must quote validated canonical values');
});

test('do validation and emission stay in the KERN statement member', () => {
  const validationEnd = statementSource.indexOf('\nfn name=emitstatementlist');
  const validationSource = statementSource.slice(0, validationEnd);
  const emissionSource = statementSource.slice(validationEnd);
  assert.ok(validationSource.includes('if cond="kind == \\"do\\""'), 'missing KERN-owned do validation');
  assert.ok(emissionSource.includes('if cond="kind == \\"do\\""'), 'missing KERN-owned do emission');
  assert.ok(validationSource.includes('facts[0] != 0'), 'do must reject child statements');
  assert.ok(validationSource.includes('let name=valueId value="facts[2]"'), 'do validation omitted value');
  assert.ok(validationSource.includes('facts[1] != 1'), 'do must reject every extra property');
  assert.ok(validationSource.includes('exprsource(valueId'), 'do values need recursive expression validation');
  assert.ok(emissionSource.includes('let name=expression value="exprsource(valueId'), 'do emission must canonicalize value');
  assert.ok(emissionSource.includes('\\"do value=\\" + quotesource(expression, true)'), 'do emission must quote validated canonical value');
});

test('while-iteration validation and emission stay in the KERN statement member', () => {
  const validationEnd = statementSource.indexOf('\nfn name=emitstatementlist');
  const validationSource = statementSource.slice(0, validationEnd);
  const emissionSource = statementSource.slice(validationEnd);
  assert.ok(validationSource.includes('if cond="kind == \\"while\\""'), 'missing KERN-owned while validation');
  assert.ok(emissionSource.includes('if cond="kind == \\"while\\""'), 'missing KERN-owned while emission');
  assert.ok(validationSource.includes('let name=condId value="facts[5]"'), 'while validation omitted cond');
  assert.ok(validationSource.includes('facts[1] != 1'), 'while must reject every extra property');
  assert.ok(validationSource.includes('exprsource(condId'), 'while conditions need recursive expression validation');
  assert.ok(validationSource.includes('validstatementlist(id'), 'while bodies must validate recursively');
  assert.ok(emissionSource.includes('let name=condition value="exprsource(condId'), 'while emission must canonicalize cond');
  assert.ok(emissionSource.includes('\\"while cond=\\" + quotesource(condition, true)'), 'while emission must quote validated canonical cond');
});

test('binary ownership stays in main and mechanically matches the structural operator catalog', () => {
  assert.equal(helperSource.includes('validbinaryop'), false);
  assert.equal(helperSource.includes('\\"binary\\"'), false);
  const expressionCatalog = readFileSync(
    new URL('../../packages/core/src/kir-structural/expression.ts', import.meta.url),
    'utf8',
  );
  const catalogBlock = /const BINARY_OPERATORS = new Set\(\[([\s\S]*?)\]\);/u.exec(expressionCatalog)?.[1];
  assert.ok(catalogBlock, 'missing structural binary catalog');
  const catalogOperators = [...catalogBlock.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  const kernFunction = /fn name=validbinaryop[\s\S]*?(?=\nfn name=)/u.exec(mainSource)?.[0];
  assert.ok(kernFunction, 'missing KERN validbinaryop');
  const kernOperators = [...kernFunction.matchAll(/op == \\"([^"\\]+)\\"/gu)].map((match) => match[1]);
  assert.equal(kernOperators.length, 24);
  assert.deepEqual(new Set(kernOperators), new Set(catalogOperators));
});

test('expression projection is one bottom-up indexed pass without recursive table scans', () => {
  const expressionSource = /fn name=exprsource[\s\S]*?(?=\nfn name=tablesok)/u.exec(mainSource)?.[0];
  assert.ok(expressionSource, 'missing KERN exprsource');
  for (const forbidden of ['exprsource(', 'valuechildcount(', 'valuechildat(', 'recordfield(']) {
    assert.equal(expressionSource.includes(forbidden), false, `exprsource retained scan path ${forbidden}`);
  }
  for (const owned of [
    'let name=childCounts value="new Map()"',
    'let name=childrenByOrder value="new Map()"',
    'let name=childrenByRole value="new Map()"',
    'let name=sources value="new Map()"',
    'for name=scan from=0 to="valueTag.length"',
    'let name=current value="valueTag.length - scan"',
    'Map.set(sources, String(current), source)',
  ]) {
    assert.ok(expressionSource.includes(owned), `exprsource omitted indexed decision ${owned}`);
  }
  assert.ok(
    expressionSource.includes('String(Text.length(valueRole[i])) + \\":\\" + String(valueRole[i])'),
    'record role keys must remain length framed and syntactically string-proven',
  );
});

test('unary validation and emission stay in the KERN-owned expression source', () => {
  assert.equal(helperSource.includes('\\"unary\\"'), false);
  const unaryStart = mainSource.indexOf('if cond="kind == \\"unary\\"');
  const unaryEnd = mainSource.indexOf('if cond="kind == \\"member\\"', unaryStart);
  assert.ok(unaryStart >= 0 && unaryEnd > unaryStart, 'missing KERN-owned unary branch');
  const unaryBranch = mainSource.slice(unaryStart, unaryEnd);
  for (const field of ['argument', 'op']) {
    assert.ok(
      unaryBranch.includes(`let name=${field}Role value="\\"record:${field}\\""`),
      `unary branch omitted ${field}`,
    );
  }
  for (const operator of ['!', '-', '~', 'typeof']) {
    assert.ok(unaryBranch.includes(`op == \\"${operator}\\"`), `unary branch omitted ${operator}`);
  }
  assert.ok(unaryBranch.includes('kind == \\"unary\\" && fieldCount == 2'), 'unary must reject extra fields');
  assert.ok(unaryBranch.includes('stringat(opId, valueTag) == \\"text\\"'), 'unary op must remain text');
  assert.ok(unaryBranch.includes('Map.has(sources, String(argumentId))'), 'unary argument must be projected first');
  assert.ok(
    unaryBranch.includes('!(op == \\"-\\" && argument == \\"0\\")'),
    'unary must reject negative zero',
  );
  assert.ok(
    unaryBranch.includes('\\"(\\" + op + \\" \\" + argument + \\")\\"'),
    'typeof emission must own source spacing and grouping',
  );
  assert.ok(
    unaryBranch.includes('\\"(\\" + op + argument + \\")\\"'),
    'symbolic unary emission must own grouping',
  );
});

test('call validation and emission stay in the KERN-owned expression source', () => {
  assert.equal(helperSource.includes('\\"call\\"'), false);
  const callStart = mainSource.indexOf('if cond="kind == \\"call\\"');
  const callEnd = mainSource.indexOf('if cond="kind == \\"list\\"', callStart);
  assert.ok(callStart >= 0 && callEnd > callStart, 'missing KERN-owned call branch');
  const callBranch = mainSource.slice(callStart, callEnd);
  for (const field of ['args', 'callee', 'optional']) {
    assert.ok(
      callBranch.includes(`let name=${field}Role value="\\"record:${field}\\""`),
      `call branch omitted ${field}`,
    );
  }
  assert.ok(callBranch.includes('numberat(optionalId, valueBool) == 0'), 'optional calls must remain fail-closed');
  assert.ok(callBranch.includes('Map.has(sources, String(calleeId))'), 'call callee must be projected first');
  assert.ok(callBranch.includes('Map.has(childrenByOrder, argOrderKey)'), 'call args must use the order index');
  assert.ok(callBranch.includes('Map.has(sources, String(argId))'), 'call args must be projected first');
});

test('member validation and emission stay in the KERN-owned expression source', () => {
  assert.equal(helperSource.includes('\\"member\\"'), false);
  const memberStart = mainSource.indexOf('if cond="kind == \\"member\\"');
  const memberEnd = mainSource.indexOf('if cond="kind == \\"index\\"', memberStart);
  assert.ok(memberStart >= 0 && memberEnd > memberStart, 'missing KERN-owned member branch');
  const memberBranch = mainSource.slice(memberStart, memberEnd);
  for (const field of ['object', 'optional', 'property']) {
    assert.ok(
      memberBranch.includes(`let name=${field}Role value="\\"record:${field}\\""`),
      `member branch omitted ${field}`,
    );
  }
  assert.ok(memberBranch.includes('numberat(optionalId, valueBool) == 0'), 'optional members must remain fail-closed');
  assert.ok(memberBranch.includes('Map.has(sources, String(objectId))'), 'member object must be projected first');
  assert.ok(memberBranch.includes('valididentifier(property)'), 'member properties must remain identifier-shaped');
  for (const rejected of ['null', 'none', 'undefined', 'true', 'false', 'await']) {
    assert.ok(memberBranch.includes(`property != \\"${rejected}\\"`), `member branch must reject ${rejected}`);
  }
});

test('index validation and emission stay in the KERN-owned expression source', () => {
  assert.equal(helperSource.includes('\\"index\\"'), false);
  const indexStart = mainSource.indexOf('if cond="kind == \\"index\\"');
  const indexEnd = mainSource.indexOf('if cond="kind == \\"call\\"', indexStart);
  assert.ok(indexStart >= 0 && indexEnd > indexStart, 'missing KERN-owned index branch');
  const indexBranch = mainSource.slice(indexStart, indexEnd);
  for (const field of ['index', 'object', 'optional']) {
    assert.ok(
      indexBranch.includes(`let name=${field}Role value="\\"record:${field}\\""`),
      'index branch omitted ' + field,
    );
  }
  assert.ok(indexBranch.includes('numberat(optionalId, valueBool) == 0'), 'optional index must remain fail-closed');
  assert.ok(indexBranch.includes('Map.has(sources, String(objectId))'), 'index object must be projected first');
  assert.ok(indexBranch.includes('Map.has(sources, String(indexId))'), 'index value must be projected first');
  assert.ok(
    indexBranch.includes('Map.get(sources, String(objectId)) + \\"[\\" + Map.get(sources, String(indexId)) + \\"]\\"'),
    'index emission must preserve bracket syntax',
  );
});

test('the pre-M4.3b semantic golden corpus bytes remain unchanged', () => {
  const hash = createHash('sha256');
  const nonBinary = VALID_FIXTURES.filter(({ id }) =>
    id !== 'profile-row-boundary' &&
    id !== 'bounded-new-expressions' &&
    !id.startsWith('binary-') && !id.startsWith('conditional-') &&
    !id.startsWith('call-') && !id.startsWith('member-') && !id.startsWith('index-') &&
    !id.startsWith('counted-iteration-') && !id.startsWith('binding-') &&
    !id.startsWith('unary-') && !id.startsWith('do-') && !id.startsWith('while-') &&
    !id.startsWith('throw-'));
  for (const fixture of nonBinary) {
    hash.update(`${fixture.id.length}:${fixture.id}:${Buffer.byteLength(fixture.golden)}:`);
    hash.update(fixture.golden);
  }
  assert.equal(nonBinary.length, 10);
  assert.equal(hash.digest('hex'), '4da70a0ae431d6e25f9142ad9d2c1b74d781eccccdc5df437f455e528cdf7590');
});

test('the admitted table profile is policy-owned and enforced by KERN', () => {
  assert.equal(existsSync(policyUrl), true, 'missing canonicalizer policy');
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  validateCanonicalizerPolicy(policy);
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4493,
  });
  assert.deepEqual(policy.expansionLimits, {
    kirToSourceMaxFactor: 4,
    runtimeEnvelopeMaxFactor: 2,
  });
  assert.equal(policy.runtimeLimits.maxStringBytes, 1_092_204);
  assert.equal(policy.runtimeLimits.maxBytes, 2_184_408);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  for (const limitName of Object.keys(policy.profileLimits)) {
    assert.match(source, new RegExp(limitName, 'u'), `KERN omitted ${limitName}`);
  }
  for (const mutate of [
    (copy) => delete copy.expansionLimits.kirToSourceMaxFactor,
    (copy) => delete copy.kirLimits.maxBytes,
    (copy) => {
      copy.runtimeLimits.futureLimit = 1;
    },
    ...Object.keys(policy.profileLimits).map((key) => (copy) => delete copy.profileLimits[key]),
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCanonicalizerPolicy(copy), /must contain exactly/u);
  }
  for (const mutate of [
    (copy) => { copy.runtimeLimits.maxStringBytes -= 1; },
    (copy) => { copy.runtimeLimits.maxBytes -= 1; },
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCanonicalizerPolicy(copy), /must cover the configured/u);
  }
});

test('the canonicalizer has no host-handler, capability, import, or delegated runtime escape', () => {
  for (const forbidden of ['handler lang=ts', 'capability namespace=', 'import ', 'use path=', 'handler code=', '<<<']) {
    assert.equal(source.includes(forbidden), false, `forbidden canonicalizer escape ${forbidden}`);
  }
});

test('the valid corpus covers every admitted return and parameter type', () => {
  const coveredReturns = new Set();
  const coveredParameters = new Set();
  for (const fixture of VALID_FIXTURES) {
    const parsed = parseDocumentWithDiagnostics(fixture.source);
    for (const root of parsed.root.children ?? []) {
      if (root.type !== 'fn') continue;
      if (typeof root.props?.returns === 'string') coveredReturns.add(root.props.returns);
      for (const child of root.children ?? []) {
        if (child.type === 'param' && typeof child.props?.type === 'string') {
          coveredParameters.add(child.props.type);
        }
      }
    }
  }
  assert.deepEqual(
    [...coveredReturns].sort(),
    ['boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]', 'void'],
  );
  assert.deepEqual(
    [...coveredParameters].sort(),
    ['boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]'],
  );
});
