function appendTextValue(tables, text, parent, role, order) {
  tables.valueTag.push('text');
  tables.valueParent.push(parent);
  tables.valueRole.push(role);
  tables.valueOrder.push(order);
  tables.valueText.push(text);
  tables.valueBool.push(0);
}

export const SEMANTIC_BOUNDARY_FIXTURES = [
  {
    id: 'duplicate-function-name',
    base: 'multiple-roots',
    category: 'profile rejection',
    mutate(tables) {
      const roots = tables.nodeParent
        .map((parent, index) => ({ id: index + 1, parent }))
        .filter((entry) => entry.parent === 0);
      const names = roots.map((root) => {
        const property = tables.propNode.findIndex(
          (node, index) => node === root.id && tables.propKey[index] === 'name',
        );
        return tables.propValue[property] - 1;
      });
      tables.valueText[names[1]] = tables.valueText[names[0]];
    },
  },
  {
    id: 'duplicate-parameter-name',
    base: 'ordered-list-text',
    category: 'profile rejection',
    mutate(tables) {
      const params = tables.nodeKind
        .map((kind, index) => ({ id: index + 1, kind }))
        .filter((entry) => entry.kind === 'param');
      const names = params.map((param) => {
        const property = tables.propNode.findIndex(
          (node, index) => node === param.id && tables.propKey[index] === 'name',
        );
        return tables.propValue[property] - 1;
      });
      tables.valueText[names[1]] = tables.valueText[names[0]];
    },
  },
  {
    id: 'nested-list-type',
    base: 'remaining-list-types',
    category: 'profile rejection',
    mutate(tables) {
      const element = tables.valueRole.findIndex((role) => role === 'record:element');
      tables.valueTag[element] = 'record';
      tables.valueText[element] = '';
      appendTextValue(tables, 'text', element + 1, 'record:kind', 0);
    },
  },
  {
    id: 'non-kern-handler',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const langProperty = tables.propKey.indexOf('lang');
      tables.valueText[tables.propValue[langProperty] - 1] = 'ts';
    },
  },
  ...[0x2028, 0x2029, 0xfeff].map((code) => ({
    id: `unsupported-text-separator-${code.toString(16)}`,
    base: 'ordered-list-text',
    category: 'profile rejection',
    mutate(tables) {
      const value = tables.valueRole.findIndex(
        (role, valueIndex) => role === 'record:value' && tables.valueText[valueIndex].includes('line'),
      );
      tables.valueText[value] = String.fromCodePoint(code);
    },
  })),
];
