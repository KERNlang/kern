type CanonicalValue =
  | { readonly tag: 'null' }
  | { readonly tag: 'bool'; readonly value: boolean }
  | { readonly tag: 'text' | 'int' | 'decimal'; readonly value: string }
  | { readonly tag: 'list'; readonly value: readonly CanonicalValue[] }
  | {
      readonly tag: 'record';
      readonly value: readonly { readonly key: string; readonly value: CanonicalValue }[];
    }
  | {
      readonly tag: 'map';
      readonly value: readonly { readonly key: CanonicalValue; readonly value: CanonicalValue }[];
    }
  | {
      readonly tag: 'error';
      readonly value: {
        readonly code: string;
        readonly details: CanonicalValue | null;
        readonly message: string;
      };
    };

interface StructuralKirNode {
  readonly children: readonly StructuralKirNode[];
  readonly kind: string;
  readonly properties: readonly { readonly key: string; readonly value: CanonicalValue }[];
}

export interface CanonicalizerTables {
  readonly nodeKind: string[];
  readonly nodeParent: number[];
  readonly nodeOrder: number[];
  readonly propNode: number[];
  readonly propKey: string[];
  readonly propValue: number[];
  readonly valueTag: string[];
  readonly valueParent: number[];
  readonly valueRole: string[];
  readonly valueOrder: number[];
  readonly valueText: string[];
  readonly valueBool: number[];
}

function emptyTables(): CanonicalizerTables {
  return {
    nodeKind: [],
    nodeParent: [],
    nodeOrder: [],
    propNode: [],
    propKey: [],
    propValue: [],
    valueTag: [],
    valueParent: [],
    valueRole: [],
    valueOrder: [],
    valueText: [],
    valueBool: [],
  };
}

/**
 * Project already-decoded structural KIR into the canonicalizer's primitive
 * transport tables. Structural validation belongs to the bounded KIR decoder;
 * the KERN handler independently validates every resulting table relation.
 */
export function flattenStructuralKir(roots: readonly StructuralKirNode[]): CanonicalizerTables {
  const tables = emptyTables();

  function addValue(value: CanonicalValue, parent: number, role: string, order: number): number {
    const id = tables.valueTag.length + 1;
    tables.valueTag.push(value.tag);
    tables.valueParent.push(parent);
    tables.valueRole.push(role);
    tables.valueOrder.push(order);
    tables.valueText.push(value.tag === 'text' || value.tag === 'int' || value.tag === 'decimal' ? value.value : '');
    tables.valueBool.push(value.tag === 'bool' && value.value ? 1 : 0);

    if (value.tag === 'list') {
      value.value.forEach((child, index) => addValue(child, id, 'list-item', index));
    } else if (value.tag === 'record') {
      value.value.forEach((entry, index) => addValue(entry.value, id, `record:${entry.key}`, index));
    } else if (value.tag === 'map') {
      value.value.forEach((entry, index) => {
        addValue(entry.key, id, 'map-key', index);
        addValue(entry.value, id, 'map-value', index);
      });
    } else if (value.tag === 'error') {
      addValue({ tag: 'text', value: value.value.code }, id, 'error-code', 0);
      addValue({ tag: 'text', value: value.value.message }, id, 'error-message', 1);
      if (value.value.details !== null) addValue(value.value.details, id, 'error-details', 2);
    }
    return id;
  }

  function addNode(node: StructuralKirNode, parent: number, order: number): void {
    const id = tables.nodeKind.length + 1;
    tables.nodeKind.push(node.kind);
    tables.nodeParent.push(parent);
    tables.nodeOrder.push(order);
    for (const property of node.properties) {
      tables.propNode.push(id);
      tables.propKey.push(property.key);
      tables.propValue.push(addValue(property.value, 0, '', 0));
    }
    node.children.forEach((child, index) => addNode(child, id, index));
  }

  roots.forEach((root, index) => addNode(root, 0, index));
  return tables;
}

export function canonicalizerTableArguments(tables: CanonicalizerTables): unknown[] {
  return [
    tables.nodeKind,
    tables.nodeParent,
    tables.nodeOrder,
    tables.propNode,
    tables.propKey,
    tables.propValue,
    tables.valueTag,
    tables.valueParent,
    tables.valueRole,
    tables.valueOrder,
    tables.valueText,
    tables.valueBool,
  ];
}
