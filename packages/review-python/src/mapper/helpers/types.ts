export type FieldTypeTag = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
export type FieldTypeMap = Readonly<Record<string, FieldTypeTag>>;

// Coarsen a Pydantic field type annotation to the same FieldTypeTag union
// the TS mapper uses, so cross-stack rules can compare client TS types
// against server Pydantic types symmetrically. Handles the common shapes:
//
//   str / int / float / bool / None / Decimal / UUID / EmailStr
//   Optional[T] / Annotated[T, ...]               → coarsen T (drop wrapper)
//   Union[A, B] / `A | B` (PEP 604)               → only stable if all agree
//   List[T] / list[T] / Sequence[T] / Tuple[...]  → 'array'
//   Dict[K, V] / dict[K, V] / Mapping[K, V]       → 'object'
//   Literal['admin'] / Literal[1] / Literal[True] → primitive of literal
//   <CapitalIdent>                                → 'object' (BaseModel sub)
//
// Anything we don't recognise → 'unknown'. Conservative on purpose:
// /type rules skip 'unknown' tags.
export function coarsenPythonTypeAnnotation(ann: string): FieldTypeTag {
  const t = ann.trim();
  if (t === '') return 'unknown';

  // Optional[T] / typing.Optional[T] — strip and recurse.
  const optMatch = t.match(/^(?:typing\.)?Optional\[([\s\S]+)\]$/);
  if (optMatch) return coarsenPythonTypeAnnotation(optMatch[1]);

  // Annotated[T, ...] — first arg is the underlying type.
  const annoMatch = t.match(/^(?:typing\.)?Annotated\[([\s\S]+)\]$/);
  if (annoMatch) {
    const parts = splitTopLevelTypeArgs(annoMatch[1], ',');
    if (parts.length >= 1) return coarsenPythonTypeAnnotation(parts[0]);
    return 'unknown';
  }

  // Union[A, B, ...] — only stable if every non-null branch agrees.
  // ANY 'unknown' branch poisons the result.
  const unionMatch = t.match(/^(?:typing\.)?Union\[([\s\S]+)\]$/);
  if (unionMatch) {
    return coarsenUnionParts(splitTopLevelTypeArgs(unionMatch[1], ','));
  }

  // PEP 604 `int | None | str`. Only treat `|` as a union separator when
  // it appears OUTSIDE of any `[...]` — otherwise `Dict[str, int | None]`
  // would be split incorrectly.
  if (containsTopLevelChar(t, '|')) {
    return coarsenUnionParts(splitTopLevelTypeArgs(t, '|'));
  }

  // Container types — coarsen to wire shape.
  if (/^(?:typing\.)?(?:List|list|Sequence|Iterable|Tuple|tuple|Set|set|FrozenSet|frozenset)\[/.test(t)) return 'array';
  if (/^(?:typing\.)?(?:Dict|dict|Mapping|MutableMapping)\[/.test(t)) return 'object';

  // Literal[X, Y, ...] — coarsen every literal arg, return the shared tag
  // ONLY when all literals agree. Mixed-primitive literals like
  // `Literal['a', 1]` accept either string or number on the wire, so
  // tagging it 'string' (first-only) would FP-flag a number client.
  // OpenCode caught this in the v1 review.
  const litMatch = t.match(/^(?:typing\.)?Literal\[([\s\S]+)\]$/);
  if (litMatch) {
    const parts = splitTopLevelTypeArgs(litMatch[1], ',');
    if (parts.length === 0) return 'unknown';
    const tags = parts.map((p) => coarsenLiteralValue(p.trim()));
    if (tags.includes('unknown')) return 'unknown';
    const set = new Set(tags);
    return set.size === 1 ? [...set][0] : 'unknown';
  }

  // Plain primitives + common Pydantic-string newtypes. `bytes` intentionally
  // stays 'unknown' — it's binary on the wire and not a JSON primitive.
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

  // Capitalized bare identifier could be:
  //   - A nested BaseModel ('object' on the wire)
  //   - A `class Status(str, Enum)` ('string' on the wire)
  //   - A `Status = Literal['a','b']` type alias ('string' on the wire)
  //   - A custom newtype like StrictStr / IPvAnyAddress
  // We can't disambiguate without symbol resolution. Tagging 'object'
  // FP'd Enum/Literal aliases against string clients (Codex flag); tag
  // 'unknown' instead — the rule will skip and we trade FN for FP.
  if (/^[A-Z][\w]*$/.test(t)) return 'unknown';

  return 'unknown';
}

// Coarsen a single literal-value source token (e.g. `'admin'`, `42`, `True`)
// to its primitive tag. Anything we don't recognise as one of the four JSON
// primitives → 'unknown'.
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

// Split a type-annotation string at top-level commas / pipes — respecting
// nested `[...]` brackets — so `Union[A, B[C, D]]` splits into `[A, B[C, D]]`
// not `[A, B[C, D]]`.
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
