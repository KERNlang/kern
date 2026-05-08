import type Parser from 'tree-sitter';
import { coarsenPythonTypeAnnotation, type FieldTypeMap, type FieldTypeTag } from '../helpers/types.js';

export interface PydanticModel {
  fields: readonly string[];
  types: FieldTypeMap;
}

export function collectPydanticModels(source: string): Map<string, PydanticModel> {
  const models = new Map<string, PydanticModel>();
  const classRe = /^class\s+([A-Za-z_]\w*)\s*\([^)]*BaseModel[^)]*\)\s*:/gm;
  for (const match of source.matchAll(classRe)) {
    const name = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const rest = source.slice(start);
    const nextTopLevel = rest.search(/\n\S/);
    const body = nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel);
    const fields: string[] = [];
    const types: Record<string, FieldTypeTag> = {};
    // Capture annotations alongside names. The annotation runs until either
    // an `=` (default value) or end-of-line / inline comment. Multiline
    // annotations (`x: Annotated[\n  str, Field(...)\n]`) are not handled —
    // false-negative on the type tag, never false-positive.
    const fieldRe = /^[ \t]+([A-Za-z_]\w*)[ \t]*:[ \t]*([^=#\n]+?)(?:[ \t]*=[^\n]*|[ \t]*#[^\n]*)?$/gm;
    for (const fieldMatch of body.matchAll(fieldRe)) {
      const field = fieldMatch[1];
      if (field === 'model_config' || field === 'Config') continue;
      fields.push(field);
      const annotation = fieldMatch[2].trim();
      types[field] = coarsenPythonTypeAnnotation(annotation);
    }
    if (fields.length > 0) {
      models.set(name, { fields: fields.sort(), types: Object.freeze({ ...types }) });
    }
  }
  return models;
}

export function extractFastApiBodyValidation(
  fnDef: Parser.SyntaxNode,
  source: string,
  pydanticModels: ReadonlyMap<string, PydanticModel>,
): {
  has: boolean;
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const body = fnDef.childForFieldName('body') ?? fnDef.namedChildren.find((child) => child.type === 'block');
  const headerEnd = body ? body.startIndex : fnDef.endIndex;
  const header = source.substring(fnDef.startIndex, headerEnd);
  const fields = new Set<string>();
  const types: Record<string, FieldTypeTag> = {};
  let has = false;
  const annotationRe = /([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g;
  for (const match of header.matchAll(annotationRe)) {
    const model = pydanticModels.get(match[2]);
    if (!model) continue;
    has = true;
    for (const field of model.fields) fields.add(field);
    for (const [name, tag] of Object.entries(model.types)) {
      // Only record concrete tags. 'unknown' for a key would shadow a
      // concrete tag from another model parameter on the same handler
      // (rare, but multi-arg handlers do exist), so skip them.
      if (tag !== 'unknown') types[name] = tag;
    }
  }
  return {
    has,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved: fields.size > 0,
    types: Object.keys(types).length > 0 ? Object.freeze({ ...types }) : undefined,
  };
}
