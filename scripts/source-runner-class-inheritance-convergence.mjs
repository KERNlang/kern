import ts from 'typescript';

export const CLASS_INHERITANCE_FILES = Object.freeze({
  classInheritance: 'packages/core/src/ir/semantics/internal-effect-machine-class-lineage.ts',
  classInheritanceTests: 'packages/core/tests/runtime-envelope-effect-machine-class-inheritance.test.ts',
  portableReferenceBody: 'packages/core/src/ir/semantics/portable-reference-body.ts',
});

function functionContainsFieldOverwrite(text, functionName) {
  const source = ts.createSourceFile('portable-reference-body.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const inspectBody = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) &&
      node.left.expression.getText(source) === 'instance.fields' &&
      node.left.argumentExpression.getText(source) === 'field.name'
    ) {
      found = true;
    }
    ts.forEachChild(node, inspectBody);
  };
  const findFunction = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      ts.forEachChild(node, inspectBody);
      return;
    }
    ts.forEachChild(node, findFunction);
  };
  findFunction(source);
  return found;
}

export function validateClassInheritanceManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-constructorless-inheritance');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_INHERITANCE_FILES.classInheritanceTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-constructorless-inheritance owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-constructorless-inheritance').length !== 1) {
    errors.push('manifest runner-class-constructorless-inheritance owner is duplicated');
  }
}

export function validateClassInheritanceSlice(contents, errors) {
  const lineage = contents.classInheritance;
  const tests = contents.classInheritanceTests;
  const runtime = [contents.classRuntime, contents.classActivation, contents.classFrame, contents.classFramePreflight]
    .filter(Boolean)
    .join('\n');
  if (!lineage || !tests) return;
  for (const required of [
    'internalMachineClassLineage',
    'export function internalMachineClassLineageBaseFirst',
    'assertInternalMachineClassInheritance',
    'internalMachineClassVisibleFields',
    'internalMachineClassMemberFor',
    'cyclic inheritance',
    'unknown base class',
    'outside the selected root module',
    'changes kind',
    'changes arity',
  ]) {
    if (!lineage.includes(required)) errors.push(`machine class inheritance owner is missing ${required}`);
  }
  for (const required of [
    'extendsName',
    'assertInternalMachineClassInheritance',
    'export function internalMachineClassRegistryForEnv',
  ]) {
    if (!contents.classGraph.includes(required)) errors.push(`machine class inheritance graph is missing ${required}`);
  }
  for (const required of [
    'internalMachineClassLineageBaseFirst',
    'internalMachineClassVisibleFields',
    'new Map(registry)',
  ]) {
    if (!runtime.includes(required)) errors.push(`machine class inheritance runtime is missing ${required}`);
  }
  if (contents.portableReferenceBody.includes('Object.hasOwn(instance.fields, field.name)')) {
    errors.push('compatibility class initialization still preserves the stale base field slot');
  }
  if (
    !functionContainsFieldOverwrite(contents.portableReferenceBody, 'initializeRunnerClassInstance') ||
    !functionContainsFieldOverwrite(contents.portableReferenceBody, 'initializeRunnerClassInstanceAsync')
  ) {
    errors.push('sync and async compatibility class initialization must both use derived overwrite semantics');
  }
  for (const oracle of [
    'normalizes the forced compatibility path to derived-field-wins',
    'owns linked source and direct transitive inheritance execution',
    'overwrites a base slot when the derived field has no initializer',
    'snapshots the complete lineage across async suspension',
    'allows an unrelated direct class constructor beside constructorless inheritance',
    'routes malformed %s lineage metadata to compatibility before provider dispatch',
    'routes a class-binding identity replaced after linker ownership to compatibility',
    'routes %s to compatibility before provider dispatch',
    'owns nested inherited dispatch in a scalar expression',
    'keeps nested inherited field reads deferred before provider execution',
  ]) {
    if (!tests.includes(oracle)) errors.push(`machine class inheritance oracle is missing: ${oracle}`);
  }
}
