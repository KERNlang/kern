export function lines(...items) {
  return `${items.join('\n')}\n`;
}

export function appendTextValue(tables, text, parent = 0, role = '', order = 0) {
  tables.valueTag.push('text');
  tables.valueParent.push(parent);
  tables.valueRole.push(role);
  tables.valueOrder.push(order);
  tables.valueText.push(text);
  tables.valueBool.push(0);
  return tables.valueTag.length;
}

export function appendRootTextValue(tables, text) {
  return appendTextValue(tables, text);
}

export function appendRootBoolValue(tables, value) {
  tables.valueTag.push('bool');
  tables.valueParent.push(0);
  tables.valueRole.push('');
  tables.valueOrder.push(0);
  tables.valueText.push('');
  tables.valueBool.push(value ? 1 : 0);
  return tables.valueTag.length;
}

export function appendRootTypeValue(tables, kind) {
  tables.valueTag.push('record');
  tables.valueParent.push(0);
  tables.valueRole.push('');
  tables.valueOrder.push(0);
  tables.valueText.push('');
  tables.valueBool.push(0);
  const id = tables.valueTag.length;
  appendTextValue(tables, kind, id, 'record:kind', 0);
  return id;
}
