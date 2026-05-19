/** Slice 4 follow-up — Python equivalent of the TS `kernStdlibPreamble`.
 *
 *  When a KERN module references the reserved type names `Result<T, E>`
 *  or `Option<T>` AND the compile target is FastAPI, the generated
 *  `main.py` needs the corresponding type aliases + frozen-dataclass
 *  wrappers in scope. Without them, `Result[User, ParseError]` in a fn
 *  signature would resolve to an undefined name at runtime.
 *
 *  Spec: docs/language/result-option-spec.md (per-target table). The
 *  spec calls for **frozen dataclass** wrappers — NOT `Optional[T]` —
 *  so `Some(None)` and `None_()` round-trip distinctly through Pydantic
 *  and the discriminant `kind` field stays uniform across all targets.
 *
 *  Detection reuses `detectKernStdlibUsage` from @kernlang/core, the same
 *  scanner the TS-family targets consume. Insertion is performed by the
 *  FastAPI transpiler entry between the `import …` block and the first
 *  emitted core node. */

import type { IRNode, KernStdlibUsage } from '@kernlang/core';
import { detectKernStdlibUsage } from '@kernlang/core';

/** Module-level imports the preamble needs. The transpiler merges these
 *  into its existing `serverImports` set so duplicates are deduped. */
export const PYTHON_STDLIB_IMPORTS = [
  'from dataclasses import dataclass',
  'from typing import Generic, Literal, TypeAlias, TypeVar, Union',
];

/** TypeVars used by both Result and Option. Kern-namespaced names avoid
 *  collisions with user-defined `T` / `E` TypeVars in the same module. */
const TYPE_VARS = ['_T_kern = TypeVar("_T_kern")', '_E_kern = TypeVar("_E_kern")'];

/** Frozen-dataclass wrappers for Result. `value` / `error` come first
 *  (no defaults); `kind` last with a default literal so constructors can
 *  be called as `Ok(value=user)` without restating the discriminant. */
const RESULT_TYPES = [
  '@dataclass(frozen=True)',
  'class Ok(Generic[_T_kern]):',
  '    value: _T_kern',
  '    kind: Literal["ok"] = "ok"',
  '',
  '@dataclass(frozen=True)',
  'class Err(Generic[_E_kern]):',
  '    error: _E_kern',
  '    kind: Literal["err"] = "err"',
  '',
  'Result: TypeAlias = Union[Ok[_T_kern], Err[_E_kern]]',
];

const OPTION_TYPES = [
  '@dataclass(frozen=True)',
  'class Some(Generic[_T_kern]):',
  '    value: _T_kern',
  '    kind: Literal["some"] = "some"',
  '',
  // `None_` (trailing underscore) — Python `None` is reserved as a
  // singleton/null literal, so the spec uses `None_` for the "absent"
  // variant of Option. Frozen + parameterless to model the unit case.
  '@dataclass(frozen=True)',
  'class None_:',
  '    kind: Literal["none"] = "none"',
  '',
  'Option: TypeAlias = Union[Some[_T_kern], None_]',
];

/** Build the preamble lines. Returns an empty array when neither Result
 *  nor Option is detected so the FastAPI output stays unchanged for
 *  modules that don't use the compact form. */
export function pythonStdlibPreamble(usage: KernStdlibUsage): string[] {
  if (!usage.result && !usage.option) return [];

  const lines: string[] = ['# ── KERN stdlib (auto-emitted) ──────────────────────────────────────', ...TYPE_VARS, ''];
  if (usage.result) {
    lines.push(...RESULT_TYPES);
    lines.push('');
  }
  if (usage.option) {
    lines.push(...OPTION_TYPES);
    lines.push('');
  }
  return lines;
}

/** Convenience wrapper that pairs detection + emission. The transpiler
 *  calls this once per build to know whether to merge the imports and
 *  what lines to insert ahead of the first core artifact. */
export function buildPythonStdlibPreamble(root: IRNode): { imports: string[]; lines: string[] } {
  const usage = detectKernStdlibUsage(root);
  const lines = pythonStdlibPreamble(usage);
  if (lines.length === 0) return { imports: [], lines: [] };
  return { imports: PYTHON_STDLIB_IMPORTS, lines };
}
