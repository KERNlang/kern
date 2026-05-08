import { type FunctionBlock, indentation, type LineInfo } from '../helpers/lines.js';
import { coarsenPythonTypeAnnotation, type FieldTypeMap, type FieldTypeTag } from '../helpers/types.js';

export interface PydanticModel {
  fields: readonly string[];
  types: FieldTypeMap;
}

export function collectPydanticModels(lines: readonly LineInfo[]): Map<string, PydanticModel> {
  const models = new Map<string, PydanticModel>();
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i];
    const match = info.text.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*\([^)]*BaseModel[^)]*\)\s*:/);
    if (!match) continue;

    const classIndent = match[1].length;
    const fields: string[] = [];
    const types: Record<string, FieldTypeTag> = {};
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.text.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation(line.text) <= classIndent) break;
      const fieldMatch = trimmed.match(/^([A-Za-z_]\w*)\s*:\s*([^=#]+?)(?:\s*=.*|\s*#.*)?$/);
      if (!fieldMatch) continue;
      const field = fieldMatch[1];
      if (field === 'model_config' || field === 'Config') continue;
      fields.push(field);
      types[field] = coarsenPythonTypeAnnotation(fieldMatch[2].trim());
    }
    if (fields.length > 0) {
      models.set(match[2], { fields: fields.sort(), types: Object.freeze({ ...types }) });
    }
  }
  return models;
}

export function fallbackBodyValidation(
  fn: FunctionBlock | undefined,
  lines: readonly LineInfo[],
  pydanticModels: ReadonlyMap<string, PydanticModel>,
): {
  has: boolean;
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  if (!fn) return { has: false, fields: undefined, resolved: false, types: undefined };
  const header = lines.find((line) => line.line === fn.startLine)?.text ?? '';
  const fields = new Set<string>();
  const types: Record<string, FieldTypeTag> = {};
  for (const match of header.matchAll(/([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g)) {
    const model = pydanticModels.get(match[2]);
    if (!model) continue;
    for (const field of model.fields) fields.add(field);
    for (const [name, tag] of Object.entries(model.types)) {
      if (tag !== 'unknown') types[name] = tag;
    }
  }
  return {
    has: fields.size > 0,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved: fields.size > 0,
    types: Object.keys(types).length > 0 ? Object.freeze({ ...types }) : undefined,
  };
}
