import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const constitution = JSON.parse(readFileSync(
  new URL('../kir-structural/constitution.json', import.meta.url), 'utf8'));
const keywordPolicy = JSON.parse(readFileSync(
  new URL('../kern-frontend-keyword-handlers/policy.json', import.meta.url), 'utf8'));

function functionSource(name, rows) {
  return [
    `fn name=${name} returns="string[]"`,
    '  handler lang="kern"',
    '    let name=out value="[]"',
    ...rows.map((row) => `    do value=${JSON.stringify(`out.push(${JSON.stringify(row)})`)}`),
    '    return value=out',
  ].join('\n');
}

export function renderAuthority(
  structuralConstitution = constitution,
  sourceFormPolicy = keywordPolicy,
) {
  const propertyRows = structuralConstitution.properties.map((property, index) => [
    String(index), property.nodeKind, property.propertyName, property.schemaKind,
    property.required ? 'true' : 'false', property.values?.join(',') ?? '',
    property.disposition, property.reasonId,
  ].join('|'));
  const nodeRows = structuralConstitution.nodes.map((node, index) => [
    String(index), node.id, node.schemaStatus,
    node.allowedChildren === null ? 'unrestricted' : node.allowedChildren.length === 0 ? 'closed' : 'explicit',
    node.allowedChildren?.join('|') ?? '',
  ].join('|'));
  const keywordRows = sourceFormPolicy.handlerCatalog.map((form, index) => [
    String(index), form, sourceFormPolicy.sourceProfile,
  ].join('|'));
  return `${functionSource('f4frozennodeauthorityrows', nodeRows)}\n\n${
    functionSource('f4frozenpropertyauthorityrows', propertyRows)}\n\n${
    functionSource('f4frozenkeywordauthorityrows', keywordRows)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(
    new URL('../../examples/kern-frontend/f4-authority.generated.kern', import.meta.url),
    renderAuthority(),
  );
}
