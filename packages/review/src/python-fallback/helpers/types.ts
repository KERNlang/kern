export type FieldTypeTag = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
export type FieldTypeMap = Readonly<Record<string, FieldTypeTag>>;

// Mirror of `coarsenPythonTypeAnnotation` in @kernlang/review-python's
// tree-sitter mapper. Both extractors should produce identical type tags
// for the same Pydantic source so cross-stack rules behave consistently
// regardless of which path was used. See that file for shape coverage.
export function coarsenPythonTypeAnnotation(ann: string): FieldTypeTag {
  const t = ann.trim();
  if (t === '') return 'unknown';

  const optMatch = t.match(/^(?:typing\.)?Optional\[([\s\S]+)\]$/);
  if (optMatch) return coarsenPythonTypeAnnotation(optMatch[1]);

  const annoMatch = t.match(/^(?:typing\.)?Annotated\[([\s\S]+)\]$/);
  if (annoMatch) {
    const parts = splitTopLevelTypeArgs(annoMatch[1], ',');
    if (parts.length >= 1) return coarsenPythonTypeAnnotation(parts[0]);
    return 'unknown';
  }

  const unionMatch = t.match(/^(?:typing\.)?Union\[([\s\S]+)\]$/);
  if (unionMatch) {
    return coarsenUnionParts(splitTopLevelTypeArgs(unionMatch[1], ','));
  }

  if (containsTopLevelChar(t, '|')) {
    return coarsenUnionParts(splitTopLevelTypeArgs(t, '|'));
  }

  if (/^(?:typing\.)?(?:List|list|Sequence|Iterable|Tuple|tuple|Set|set|FrozenSet|frozenset)\[/.test(t)) return 'array';
  if (/^(?:typing\.)?(?:Dict|dict|Mapping|MutableMapping)\[/.test(t)) return 'object';

  // Mirror of the tree-sitter mapper: every Literal arg must coarsen to
  // the same primitive tag, else 'unknown'. Mixed `Literal['a', 1]` would
  // FP a number client against a 'string' tag.
  const litMatch = t.match(/^(?:typing\.)?Literal\[([\s\S]+)\]$/);
  if (litMatch) {
    const parts = splitTopLevelTypeArgs(litMatch[1], ',');
    if (parts.length === 0) return 'unknown';
    const tags = parts.map((p) => coarsenLiteralValue(p.trim()));
    if (tags.includes('unknown')) return 'unknown';
    const set = new Set(tags);
    return set.size === 1 ? [...set][0] : 'unknown';
  }

  switch (t) {
    case 'str':
    case 'EmailStr':
    case 'HttpUrl':
    case 'AnyUrl':
    case 'AnyHttpUrl':
    case 'UUID':
    case 'UUID1':
    case 'UUID3':
    case 'UUID4':
    case 'UUID5':
    case 'SecretStr':
      return 'string';
    case 'int':
    case 'float':
    case 'Decimal':
    case 'PositiveInt':
    case 'NegativeInt':
    case 'NonNegativeInt':
    case 'NonPositiveInt':
    case 'PositiveFloat':
    case 'NegativeFloat':
      return 'number';
    case 'bool':
    case 'StrictBool':
      return 'boolean';
    case 'None':
    case 'NoneType':
      return 'null';
  }

  // Capitalized bare ident → 'unknown' (could be Enum/alias/newtype, not
  // necessarily a BaseModel). Mirror of the tree-sitter mapper choice.
  if (/^[A-Z][\w]*$/.test(t)) return 'unknown';
  return 'unknown';
}

export function coarsenLiteralValue(v: string): FieldTypeTag {
  if (/^['"]/.test(v)) return 'string';
  if (/^-?\d/.test(v)) return 'number';
  if (v === 'True' || v === 'False') return 'boolean';
  if (v === 'None') return 'null';
  return 'unknown';
}

export function coarsenUnionParts(parts: readonly string[]): FieldTypeTag {
  const tags = parts.map(coarsenPythonTypeAnnotation);
  if (tags.includes('unknown')) return 'unknown';
  const noNull = tags.filter((tag) => tag !== 'null');
  if (noNull.length === 0) return 'null';
  const set = new Set(noNull);
  return set.size === 1 ? [...set][0] : 'unknown';
}

export function splitTopLevelTypeArgs(s: string, delim: ',' | '|'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === delim && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function containsTopLevelChar(s: string, ch: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ch && depth === 0) return true;
  }
  return false;
}
