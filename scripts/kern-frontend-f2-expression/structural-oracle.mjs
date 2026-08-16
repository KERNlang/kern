function compareCodePoints(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const count = Math.min(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    const leftScalar = a[index].codePointAt(0);
    const rightScalar = b[index].codePointAt(0);
    if (leftScalar !== rightScalar) return leftScalar - rightScalar;
  }
  return a.length - b.length;
}

function record(fields) {
  return {
    tag: 'record',
    value: Object.entries(fields)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, value]) => ({ key, value })),
  };
}

function expression(kind, fields) {
  return record({ fields: record(fields), kind: { tag: 'text', value: kind } });
}

function text(value) {
  return { tag: 'text', value };
}

function list(value) {
  return { tag: 'list', value };
}

export function decodedToStructural(decoded) {
  if (decoded.status !== 'parsed') throw new Error('F2 structural oracle requires parsed input');
  const values = [];
  for (const node of decoded.nodes) {
    const child = (index) => values[node.children[index]];
    let value;
    switch (node.kindId) {
      case 0:
        value = expression('identifier', { name: text(node.payload[0]) });
        break;
      case 1:
        value = expression('null', {});
        break;
      case 2:
        value = expression('boolean', { value: { tag: 'bool', value: node.payload[0] === 'true' } });
        break;
      case 3:
        value = expression('integer', { value: { tag: 'int', value: node.payload[0] } });
        break;
      case 4:
        value = expression('decimal', { value: { tag: 'decimal', value: node.payload[0] } });
        break;
      case 5:
        value = expression('text', { value: text(node.payload[0]) });
        break;
      case 6:
        value = expression('list', { items: list(node.children.map((_, index) => child(index))) });
        break;
      case 7: {
        const entries = Object.fromEntries(node.payload.map((key, index) => [key, child(index)]));
        value = expression('record', { entries: record(entries) });
        break;
      }
      case 8:
        value = expression('member', {
          object: child(0), optional: { tag: 'bool', value: node.flags === 1 }, property: text(node.payload[0]),
        });
        break;
      case 9:
        value = expression('index', {
          index: child(1), object: child(0), optional: { tag: 'bool', value: node.flags === 1 },
        });
        break;
      case 10:
        value = expression('call', {
          args: list(node.children.slice(1).map((_, index) => child(index + 1))),
          callee: child(0),
          optional: { tag: 'bool', value: node.flags === 1 },
        });
        break;
      case 11:
        value = expression('new', {
          args: list(node.children.map((_, index) => child(index))), constructor: text(node.payload[0]),
        });
        break;
      case 12:
        value = expression('lambda', { body: child(0), params: list(node.payload.map(text)) });
        break;
      case 13:
        value = expression('binary', { left: child(0), op: text(node.payload[0]), right: child(1) });
        break;
      case 14:
        value = expression('unary', { argument: child(0), op: text(node.payload[0]) });
        break;
      case 15:
        value = expression('conditional', { alternate: child(2), consequent: child(1), test: child(0) });
        break;
      default:
        throw new Error(`F2 structural oracle unknown kind ${node.kindId}`);
    }
    values.push(value);
  }
  return values.at(-1);
}
