import {
  isPortableBindingName,
} from '../../packages/core/dist/ir/semantics/portable-scalar-domain.js';

const PORTABLE_PARAMETER_TYPES = new Set([
  'boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]',
]);

export function parseLegacyParameters(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new TypeError('coverage prerequisite rejection: legacy parameters must be non-empty text');
  }
  const names = new Set();
  return raw.split(',').map((entry) => {
    const parts = entry.split(':').map((part) => part.trim());
    if (
      parts.length !== 2 ||
      !isPortableBindingName(parts[0]) ||
      !PORTABLE_PARAMETER_TYPES.has(parts[1]) ||
      names.has(parts[0])
    ) {
      throw new TypeError(
        'coverage prerequisite rejection: legacy parameters must be unique portable name:type pairs',
      );
    }
    names.add(parts[0]);
    return { name: parts[0], type: parts[1] };
  });
}

