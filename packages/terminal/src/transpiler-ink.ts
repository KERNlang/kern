import type { AccountedEntry, IRNode, ResolvedKernConfig, SourceMapEntry, TranspileResult } from '@kernlang/core';
import {
  accountNode,
  buildDiagnostics,
  countTokens,
  dedent,
  generateCoreNode,
  generateMachineReducer,
  getChildren,
  getProps,
  isCoreNode,
  serializeIR,
} from '@kernlang/core';

/**
 * Ink Transpiler — generates React (Ink) TSX components for terminal UIs
 *
 * Maps KERN terminal nodes to Ink components:
 *   screen  → React function component (export default)
 *   text    → <Text bold color="blue">...</Text>
 *   box     → <Box borderStyle="round" borderColor="blue">...</Box>
 *   separator → <Text dimColor>{'─'.repeat(48)}</Text>
 *   table   → <Box flexDirection="column"> with row components
 *   scoreboard → <Box flexDirection="column"> with metric rows
 *   spinner → <Text><Spinner /> {message}</Text>
 *   progress → <Box><Text>{bar}</Text></Box>
 *   gradient → <Text>{gradientChars}</Text>
 *   state   → const [x, setX] = useState(initial)
 *   ref     → const xRef = useRef(initial)
 *   stream  → useEffect with async generator iteration (streaming output)
 *   logic   → useEffect with side-effect code
 *   machine → standard output + useReducer hook
 *   conditional → {condition && (<>...</>)}
 *   input-area  → <Box> at bottom of screen (persistent input region)
 *   output-area → <Box flexGrow={1}> scrollable output region
 *   text-input  → <TextInput value={...} onChange={...} />
 *   select-input → <SelectInput items={...} onSelect={...} />
 *   handler → raw JSX injection
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Check if a prop value is a {{ expression }} object from the parser. */
function isExpr(v: unknown): v is { __expr: true; code: string } {
  return typeof v === 'object' && v !== null && '__expr' in v;
}

/** Unwrap a prop value: expressions return their code, strings return as-is. */
function unwrapProp(v: unknown): string {
  if (isExpr(v)) return (v as { code: string }).code;
  return String(v ?? '');
}

/** Split a comma-separated prop string while respecting angle-bracket/paren depth. */
function splitPropsRespectingDepth(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Convert KERN condition to JS expression — handles __expr and shorthand. */
function irConditionToJs(cond: unknown): string {
  if (isExpr(cond)) return (cond as { code: string }).code;
  return String(cond)
    .replace(/&/g, ' && ')
    .replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'");
}

/** Convert KERN style value to Ink-compatible color prop */
function inkColor(color: unknown): string {
  if (typeof color === 'number') return `{${color}}`;
  if (typeof color === 'string') {
    if (color.startsWith('#')) return `"${color}"`;
    return `"${color}"`;
  }
  return '"white"';
}

/** Ink key name → key object property check */
function keyToCheck(key: string): string {
  switch (key) {
    case 'return':
    case 'Enter':
      return 'key.return';
    case 'escape':
    case 'Escape':
      return 'key.escape';
    case 'tab':
    case 'Tab':
      return 'key.tab';
    case 'up':
    case 'ArrowUp':
      return 'key.upArrow';
    case 'down':
    case 'ArrowDown':
      return 'key.downArrow';
    case 'left':
    case 'ArrowLeft':
      return 'key.leftArrow';
    case 'right':
    case 'ArrowRight':
      return 'key.rightArrow';
    case 'backspace':
    case 'Backspace':
      return 'key.backspace';
    case 'delete':
    case 'Delete':
      return 'key.delete';
    default:
      return `input === '${key}'`;
  }
}

// ── Import tracker ──────────────────────────────────────────────────────

class ImportTracker {
  private reactImports = new Set<string>();
  private inkImports = new Set<string>();
  private inkUIImports = new Set<string>();

  addReact(name: string): void {
    this.reactImports.add(name);
  }
  addInk(name: string): void {
    this.inkImports.add(name);
  }
  /** Add an @inkjs/ui component import. */
  addInkUI(name: string): void {
    this.inkUIImports.add(name);
  }
  // Legacy convenience methods — now route to @inkjs/ui
  needSpinner(): void {
    this.inkUIImports.add('Spinner');
  }
  needTextInput(): void {
    this.inkUIImports.add('TextInput');
  }
  needSelectInput(): void {
    this.inkUIImports.add('Select');
  }

  emit(): string[] {
    const lines: string[] = [];
    if (this.reactImports.size > 0) {
      lines.push(`import React, { ${[...this.reactImports].sort().join(', ')} } from 'react';`);
    } else {
      lines.push(`import React from 'react';`);
    }
    if (this.inkImports.size > 0) {
      lines.push(`import { ${[...this.inkImports].sort().join(', ')} } from 'ink';`);
    }
    if (this.inkUIImports.size > 0) {
      lines.push(`import { ${[...this.inkUIImports].sort().join(', ')} } from '@inkjs/ui';`);
    }
    return lines;
  }
}

// ── Ink-safe setter utility ─────────────────────────────────────────────

/** Emit the __inkSafe helper once per component — bridges microtask→macrotask for Ink repaints. */
function emitInkSafePreamble(): string[] {
  return [
    '  // Ink-safe setter: bridges microtask → macrotask for reliable repaints',
    '  function __inkSafe<T>(setter: React.Dispatch<React.SetStateAction<T>>): React.Dispatch<React.SetStateAction<T>> {',
    '    return (value) => setTimeout(() => setter(value), 0);',
    '  }',
    '',
  ];
}

// ── State block → useState ──────────────────────────────────────────────

interface StateHookContext {
  needsInkSafe: boolean;
}

function generateStateHook(stateNode: IRNode, imports: ImportTracker, ctx: StateHookContext): string[] {
  const lines: string[] = [];
  const props = getProps(stateNode);
  const name = props.name as string;
  const initialProp = props.initial;
  const safe = props.safe !== 'false' && props.safe !== false; // default true

  if (name && initialProp !== undefined) {
    imports.addReact('useState');
    const initial = isExpr(initialProp) ? (initialProp as { code: string }).code : String(initialProp);
    const initVal = isExpr(initialProp)
      ? initial
      : initial === ''
        ? "''"
        : initial === 'null'
          ? 'null'
          : initial === 'true'
            ? 'true'
            : initial === 'false'
              ? 'false'
              : initial.startsWith('[') || initial.startsWith('{')
                ? initial
                : initial.startsWith("'") || initial.startsWith('"')
                  ? initial
                  : initial.includes('(') || initial.includes('.')
                    ? initial
                    : Number.isNaN(Number(initial))
                      ? `'${initial}'`
                      : String(initial);
    const setter = `set${capitalize(name)}`;
    const typeAnnotation = props.type ? `<${props.type as string}>` : '';

    const throttle = props.throttle as string | undefined;
    const debounce = props.debounce as string | undefined;

    if (throttle) {
      // Throttled setter — rate-limits updates, uses setTimeout for Ink safety
      imports.addReact('useMemo');
      lines.push(`  const [${name}, _${setter}Raw] = useState${typeAnnotation}(${initVal});`);
      lines.push(`  const ${setter} = useMemo(() => {`);
      lines.push(`    let _lastCall = 0;`);
      lines.push(`    return (value: React.SetStateAction<${typeAnnotation ? (props.type as string) : 'any'}>) => {`);
      lines.push(`      const now = Date.now();`);
      lines.push(`      if (now - _lastCall >= ${throttle}) {`);
      lines.push(`        _lastCall = now;`);
      lines.push(`        setTimeout(() => _${setter}Raw(value), 0);`);
      lines.push(`      }`);
      lines.push(`    };`);
      lines.push(`  }, []);`);
    } else if (debounce) {
      // Debounced setter — delays updates, uses setTimeout for Ink safety
      imports.addReact('useMemo');
      lines.push(`  const [${name}, _${setter}Raw] = useState${typeAnnotation}(${initVal});`);
      lines.push(`  const ${setter} = useMemo(() => {`);
      lines.push(`    let _timer: ReturnType<typeof setTimeout> | null = null;`);
      lines.push(`    return (value: React.SetStateAction<${typeAnnotation ? (props.type as string) : 'any'}>) => {`);
      lines.push(`      if (_timer) clearTimeout(_timer);`);
      lines.push(`      _timer = setTimeout(() => _${setter}Raw(value), ${debounce});`);
      lines.push(`    };`);
      lines.push(`  }, []);`);
    } else if (safe) {
      ctx.needsInkSafe = true;
      imports.addReact('useMemo');
      lines.push(`  const [${name}, _${setter}Raw] = useState${typeAnnotation}(${initVal});`);
      lines.push(`  const ${setter} = useMemo(() => __inkSafe(_${setter}Raw), [_${setter}Raw]);`);
    } else {
      lines.push(`  const [${name}, ${setter}] = useState${typeAnnotation}(${initVal});`);
    }
  }

  return lines;
}

// ── Ref block → useRef (Feature #10) ────────────────────────────────────

function generateRefHook(refNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(refNode);
  const name = props.name as string;
  const initialProp = props.initial;

  if (name) {
    imports.addReact('useRef');
    const initVal =
      initialProp === undefined ? 'null' : isExpr(initialProp) ? unwrapProp(initialProp) : String(initialProp);
    const refName = name.endsWith('Ref') ? name : `${name}Ref`;
    const typeAnnotation = props.type ? `<${props.type as string}>` : '';
    lines.push(`  const ${refName} = useRef${typeAnnotation}(${initVal});`);
  }

  return lines;
}

// ── Stream block → useEffect with async generator ───────────────────────

function generateStreamEffect(streamNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(streamNode);
  const name = props.name as string;
  const source = props.source as string;
  const append = props.append !== 'false'; // default true

  if (name && source) {
    imports.addReact('useEffect');
    const setter = `set${capitalize(name)}`;

    lines.push(`  useEffect(() => {`);
    lines.push(`    let cancelled = false;`);
    lines.push(`    (async () => {`);
    lines.push(`      for await (const chunk of ${source}()) {`);
    lines.push(`        if (cancelled) break;`);
    if (append) {
      lines.push(`        ${setter}(prev => [...prev, chunk]);`);
    } else {
      lines.push(`        ${setter}(chunk);`);
    }
    lines.push(`      }`);
    lines.push(`    })();`);
    lines.push(`    return () => { cancelled = true; };`);
    lines.push(`  }, []);`);
  }

  return lines;
}

// ── Logic block → useEffect (Feature #8) ────────────────────────────────

function generateLogicEffect(logicNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(logicNode);
  const deps = props.deps as string;
  // Support both inline code prop and handler child
  const handlerChild = (logicNode.children || []).find((c) => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string) || '' : (props.code as string) || '';

  if (code) {
    imports.addReact('useEffect');
    const dedented = dedent(code);
    const depsStr = deps ? `[${deps}]` : '[]';

    // Auto-cleanup: detect setInterval/setTimeout at top-level scope (not inside nested functions)
    const hasCleanup = /return\s*\(\s*\)\s*=>/.test(dedented) || /return\s*\(\)\s*\{/.test(dedented);
    // Only match if declaration appears before any function/arrow — i.e., at the effect's top level
    const hasNestedFn = /(?:function\s|=>)/.test(dedented.split(/set(?:Interval|Timeout)\s*\(/)[0] || '');
    const intervalMatch = hasNestedFn ? null : dedented.match(/(?:const|let|var)\s+(\w+)\s*=\s*setInterval\s*\(/);
    const timeoutMatch = hasNestedFn ? null : dedented.match(/(?:const|let|var)\s+(\w+)\s*=\s*setTimeout\s*\(/);

    lines.push(`  useEffect(() => {`);
    for (const line of dedented.split('\n')) {
      lines.push(`    ${line}`);
    }
    if (!hasCleanup && intervalMatch) {
      lines.push(`    return () => { clearInterval(${intervalMatch[1]}); };`);
    } else if (!hasCleanup && timeoutMatch) {
      lines.push(`    return () => { clearTimeout(${timeoutMatch[1]}); };`);
    }
    lines.push(`  }, ${depsStr});`);
  }

  return lines;
}

// ── Focus hook → useFocus (Phase 3) ────────────────────────────────

function generateFocusHook(focusNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(focusNode);
  const name = props.name as string;
  const autoFocus = props.autoFocus === 'true' || props.autoFocus === true;
  const id = props.id as string;

  if (name) {
    imports.addInk('useFocus');
    const opts: string[] = [];
    if (autoFocus) opts.push('autoFocus: true');
    if (id) opts.push(`id: '${id}'`);
    const optsStr = opts.length > 0 ? `{ ${opts.join(', ')} }` : '';
    lines.push(`  const { isFocused: ${name} } = useFocus(${optsStr});`);
  }

  return lines;
}

// ── App exit hook → useApp (Phase 3) ───────────────────────────────

function generateAppExitHook(exitNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(exitNode);
  const on = props.on;

  if (on) {
    imports.addInk('useApp');
    imports.addReact('useEffect');
    const condition = isExpr(on) ? (on as { code: string }).code : String(on);
    lines.push(`  const { exit } = useApp();`);
    lines.push(`  useEffect(() => { if (${condition}) exit(); }, [${condition}]);`);
  }

  return lines;
}

// ── Animation block → useEffect with setInterval ────────────────────

function generateAnimation(animNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(animNode);
  const name = props.name as string;
  const interval = props.interval as string;
  const update = isExpr(props.update) ? (props.update as { code: string }).code : String(props.update || '');
  const active = props.active;

  if (name && interval && update) {
    imports.addReact('useEffect');
    const setter = `set${capitalize(name)}`;

    if (active) {
      const activeExpr = isExpr(active) ? (active as { code: string }).code : String(active);
      lines.push(`  useEffect(() => {`);
      lines.push(`    if (!(${activeExpr})) return;`);
      lines.push(`    const _animId = setInterval(() => {`);
      lines.push(`      ${setter}(${update});`);
      lines.push(`    }, ${interval});`);
      lines.push(`    return () => clearInterval(_animId);`);
      lines.push(`  }, [${activeExpr}]);`);
    } else {
      lines.push(`  useEffect(() => {`);
      lines.push(`    const _animId = setInterval(() => {`);
      lines.push(`      ${setter}(${update});`);
      lines.push(`    }, ${interval});`);
      lines.push(`    return () => clearInterval(_animId);`);
      lines.push(`  }, []);`);
    }
  }

  return lines;
}

// ── Callback block → useCallback (Feature #11) ─────────────────────────

function generateCallbackHook(callbackNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(callbackNode);
  const name = props.name as string;
  const params = (props.params as string) || '';
  const deps = props.deps as string;
  const handlerChild = (callbackNode.children || []).find((c) => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';

  if (name && code) {
    imports.addReact('useCallback');
    // Auto-detect hooks used inside callback handler code
    if (code.includes('useMemo')) imports.addReact('useMemo');
    if (code.includes('useRef')) imports.addReact('useRef');
    const dedented = dedent(code);
    const depsStr = deps ? `[${deps}]` : '[]';
    const isAsync = props.async === 'true' || props.async === true;
    const asyncKw = isAsync ? 'async ' : '';

    lines.push(`  const ${name} = useCallback(${asyncKw}(${params}) => {`);
    for (const line of dedented.split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push(`  }, ${depsStr});`);
  }

  return lines;
}

// ── Collect nested on-nodes from UI tree for hoisting (Bug #1) ─────────

function collectNestedOnNodes(node: IRNode): IRNode[] {
  const found: IRNode[] = [];
  for (const child of node.children || []) {
    if (child.type === 'on') {
      found.push(child);
    } else if (!['state', 'stream', 'logic', 'callback', 'ref'].includes(child.type) && !isCoreNode(child.type)) {
      found.push(...collectNestedOnNodes(child));
    }
  }
  return found;
}

// ── Generate useInput from an on-node ───────────────────────────────────

let _onHookCounter = 0;

function generateOnHook(onNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const onProps = getProps(onNode);
  const event = (onProps.event || onProps.name) as string;

  if (event === 'key' || event === 'input') {
    imports.addInk('useInput');
    imports.addReact('useRef');
    const key = onProps.key as string;
    const handlerChild = (onNode.children || []).find((c) => c.type === 'handler');
    const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';

    // Use ref pattern with unique suffix for fresh closures — supports multiple on-nodes
    const suffix = _onHookCounter === 0 ? '' : `_${_onHookCounter}`;
    _onHookCounter++;
    const refName = `_inputHandlerRef${suffix}`;
    lines.push(`  const ${refName} = useRef<(input: string, key: any) => void>(() => {});`);
    lines.push(`  ${refName}.current = (input: string, key: any) => {`);
    if (key) {
      lines.push(`    if (!(${keyToCheck(key)})) return;`);
    }
    if (code) {
      const dedented = dedent(code);
      for (const line of dedented.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`  };`);
    lines.push(`  useInput((input: string, key: any) => ${refName}.current(input, key));`);
    lines.push('');
  }

  return lines;
}

// ── Per-node JSX Renderers ───────────────────────────────────────────────

function renderInkText(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Text');
  const rawValue = p.value;
  const styles = (p.styles as Record<string, string>) || {};
  const textProps: string[] = [];

  if (styles.fw === 'bold' || styles.bold) textProps.push('bold');
  if (styles.dim) textProps.push('dimColor');
  if (styles.italic) textProps.push('italic');
  if (styles.c || styles.color) textProps.push(`color=${inkColor(styles.c || styles.color)}`);
  if (styles.bg) textProps.push(`backgroundColor=${inkColor(styles.bg)}`);

  const propsStr = textProps.length > 0 ? ` ${textProps.join(' ')}` : '';
  if (isExpr(rawValue)) {
    return [`${indent}<Text${propsStr}>{${(rawValue as { code: string }).code}}</Text>`];
  }
  const value = String(rawValue ?? '');
  return [`${indent}<Text${propsStr}>{${JSON.stringify(value)}}</Text>`];
}

function renderInkSeparator(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Text');
  const width = Number(p.width) || 48;
  return [`${indent}<Text dimColor>{'${'─'.repeat(width)}'}</Text>`];
}

function renderInkBox(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  imports.addInk('Text');
  const color = p.color as string;
  const borderStyle = (p.borderStyle as string) || 'round';
  const flexDirection = p.flexDirection as string;
  const width = p.width as string;
  const flexGrow = p.flexGrow as string;
  const padding = p.padding as string;
  const paddingX = p.paddingX as string;
  const paddingY = p.paddingY as string;

  const boxProps: string[] = [];
  if (color) boxProps.push(`borderStyle="${borderStyle}"`, `borderColor=${inkColor(color)}`);
  if (flexDirection) boxProps.push(`flexDirection="${flexDirection}"`);
  if (width) boxProps.push(`width={${width}}`);
  if (flexGrow) boxProps.push(`flexGrow={${flexGrow}}`);
  if (padding) boxProps.push(`padding={${padding}}`);
  if (paddingX) boxProps.push(`paddingX={${paddingX}}`);
  if (paddingY) boxProps.push(`paddingY={${paddingY}}`);

  const propsStr = boxProps.length > 0 ? ` ${boxProps.join(' ')}` : '';
  const lines: string[] = [];
  lines.push(`${indent}<Box${propsStr}>`);

  for (const child of node.children || []) {
    if (child.type === 'on') continue;
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }

  lines.push(`${indent}</Box>`);
  return lines;
}

function renderInkTable(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  imports.addInk('Text');
  const headers = (p.headers as string) || '[]';
  const rows = getChildren(node, 'row');
  const lines: string[] = [];

  lines.push(`${indent}<Box flexDirection="column">`);
  lines.push(`${indent}  <Box>`);
  lines.push(`${indent}    {(${headers} as string[]).map((h: string, i: number) => (`);
  lines.push(`${indent}      <Box key={i} width={20}><Text bold>{h}</Text></Box>`);
  lines.push(`${indent}    ))}`);
  lines.push(`${indent}  </Box>`);
  lines.push(`${indent}  <Text dimColor>{'${'─'.repeat(60)}'}</Text>`);
  for (const row of rows) {
    const rowData = (getProps(row).data as string) || '[]';
    lines.push(`${indent}  <Box>`);
    lines.push(`${indent}    {(${rowData} as string[]).map((cell: string, i: number) => (`);
    lines.push(`${indent}      <Box key={i} width={20}><Text>{cell}</Text></Box>`);
    lines.push(`${indent}    ))}`);
    lines.push(`${indent}  </Box>`);
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderInkScoreboard(
  node: IRNode,
  p: Record<string, unknown>,
  indent: string,
  imports: ImportTracker,
): string[] {
  imports.addInk('Box');
  imports.addInk('Text');
  const title = (p.title as string) || 'Results';
  const winner = (p.winner as string) || '';
  const metrics = getChildren(node, 'metric');
  const lines: string[] = [];

  lines.push(`${indent}<Box flexDirection="column">`);
  lines.push(`${indent}  <Text bold>{${JSON.stringify(title)}}</Text>`);
  if (winner) {
    lines.push(`${indent}  <Text bold color="green">{'Winner: ${winner}'}</Text>`);
  }
  for (const metric of metrics) {
    const mp = getProps(metric);
    const mname = (mp.name as string) || '';
    const values = (mp.values as string) || '[]';
    lines.push(`${indent}  <Box>`);
    lines.push(`${indent}    <Text dimColor>{${JSON.stringify(`${mname}:`)}}</Text>`);
    lines.push(`${indent}    <Text>{' '}{(${values} as string[]).join(' | ')}</Text>`);
    lines.push(`${indent}  </Box>`);
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderInkSpinner(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Text');
  imports.needSpinner();
  const rawMsg = p.message;
  const color = p.color as string;
  const spinnerColor = color ? ` color=${inkColor(color)}` : '';
  const msgContent = isExpr(rawMsg)
    ? `{${(rawMsg as { code: string }).code}}`
    : `{' ${String(rawMsg ?? 'Loading...')}'}`;
  return [`${indent}<Text>`, `${indent}  <Spinner${spinnerColor} />`, `${indent}  ${msgContent}`, `${indent}</Text>`];
}

function renderInkProgress(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  imports.addInk('Text');
  const rawValue = p.value;
  const rawMax = p.max;
  const color = (p.color as string) || 'green';
  const barWidth = 20;
  const lines: string[] = [];

  if (isExpr(rawValue) || isExpr(rawMax)) {
    const valueExpr = isExpr(rawValue) ? (rawValue as { code: string }).code : String(rawValue ?? 0);
    const maxExpr = isExpr(rawMax) ? (rawMax as { code: string }).code : String(rawMax ?? 100);
    lines.push(`${indent}<Box>`);
    lines.push(`${indent}  {(() => {`);
    lines.push(`${indent}    const _pct = Math.min(1, Math.max(0, (${valueExpr}) / (${maxExpr})));`);
    lines.push(`${indent}    const _filled = Math.round(_pct * ${barWidth});`);
    lines.push(`${indent}    const _empty = ${barWidth} - _filled;`);
    lines.push(`${indent}    return (<>`);
    lines.push(`${indent}      <Text color=${inkColor(color)}>${'{'}'▓'.repeat(_filled)${'}'}</Text>`);
    lines.push(`${indent}      <Text>${'{'}'░'.repeat(_empty)${'}'}</Text>`);
    lines.push(`${indent}      <Text>{' ' + Math.round(_pct * 100) + '%'}</Text>`);
    lines.push(`${indent}    </>);`);
    lines.push(`${indent}  })()}`);
    lines.push(`${indent}</Box>`);
  } else {
    const value = Number(rawValue) || 0;
    const max = Number(rawMax) || 100;
    const pct = Math.min(1, Math.max(0, value / max));
    const filled = Math.round(pct * barWidth);
    const empty = barWidth - filled;

    lines.push(`${indent}<Box>`);
    lines.push(`${indent}  <Text color=${inkColor(color)}>{'${'▓'.repeat(filled)}'}</Text>`);
    lines.push(`${indent}  <Text>{'${'░'.repeat(empty)}'}</Text>`);
    lines.push(`${indent}  <Text>{' ${Math.round(pct * 100)}%'}</Text>`);
    lines.push(`${indent}</Box>`);
  }
  return lines;
}

function renderInkGradient(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Text');
  const text = (p.text as string) || '';
  const colors = (p.colors as string) || '[]';
  return [
    `${indent}<Text>`,
    `${indent}  {${JSON.stringify(text)}.split('').map((ch: string, i: number) => {`,
    `${indent}    const colors = ${colors} as number[];`,
    `${indent}    const colorIdx = Math.floor((i / ${text.length}) * colors.length);`,
    `${indent}    const color = String(colors[Math.min(colorIdx, colors.length - 1)]);`,
    `${indent}    return <Text key={i} color={color}>{ch}</Text>;`,
    `${indent}  })}`,
    `${indent}</Text>`,
  ];
}

function renderInkInputArea(node: IRNode, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  const lines: string[] = [];
  lines.push(`${indent}<Box flexDirection="column" borderStyle="single" borderColor="gray">`);
  for (const child of node.children || []) {
    if (child.type === 'on') continue;
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderInkOutputArea(node: IRNode, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  const lines: string[] = [];
  lines.push(`${indent}<Box flexDirection="column" flexGrow={1}>`);
  for (const child of node.children || []) {
    if (child.type === 'on') continue;
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderInkTextInput(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.needTextInput();
  const placeholder = (p.placeholder as string) || '';
  const bind = p.bind as string;
  const history = p.history as string;
  const onSubmit = p.onSubmit as string;
  const inputProps: string[] = [];
  if (placeholder) inputProps.push(`placeholder=${JSON.stringify(placeholder)}`);
  if (history) inputProps.push(`history={${history}}`);
  if (bind) {
    inputProps.push(`value={${bind}}`);
    inputProps.push(`onChange={set${capitalize(bind)}}`);
  }
  if (onSubmit) {
    inputProps.push(`onSubmit={${onSubmit}}`);
  }
  return [`${indent}<TextInput ${inputProps.join(' ')} />`];
}

function renderInkSelectInput(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.needSelectInput();
  const rawItems = p.items;
  const items = isExpr(rawItems) ? (rawItems as { code: string }).code : (rawItems as string) || '[]';
  const onSelect = p.onSelect as string;
  const onChange = p.onChange as string;
  const selectProps: string[] = [`options={${items}}`];
  if (onSelect) {
    selectProps.push(`onChange={${onSelect}}`);
  } else if (onChange) {
    selectProps.push(`onChange={${onChange}}`);
  }
  return [`${indent}<Select ${selectProps.join(' ')} />`];
}

function renderInkHandler(p: Record<string, unknown>, indent: string): string[] {
  const code = (p.code as string) || '';
  const dedented = dedent(code);
  return dedented.split('\n').map((line) => `${indent}${line}`);
}

function renderInkEach(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  const rawCollection = p.collection;
  const collection = isExpr(rawCollection)
    ? (rawCollection as { code: string }).code
    : (rawCollection as string) || '[]';
  const item = (p.item as string) || 'item';
  const index = (p.index as string) || 'i';
  const rawKey = p.key;
  const key = isExpr(rawKey) ? (rawKey as { code: string }).code : (rawKey as string) || index;

  const lines: string[] = [];
  lines.push(`${indent}{${collection}.map((${item}, ${index}) => (`);
  const children = node.children || [];
  if (children.length === 1) {
    const childLines = renderInkNode(children[0], `${indent}  `, imports);
    if (childLines.length > 0) {
      childLines[0] = childLines[0].replace(/^(\s*<\w+)/, `$1 key={${key}}`);
    }
    lines.push(...childLines);
  } else {
    lines.push(`${indent}  <React.Fragment key={${key}}>`);
    for (const child of children) {
      lines.push(...renderInkNode(child, `${indent}    `, imports));
    }
    lines.push(`${indent}  </React.Fragment>`);
  }
  lines.push(`${indent}))}`);
  return lines;
}

function renderInkConditional(
  node: IRNode,
  p: Record<string, unknown>,
  indent: string,
  imports: ImportTracker,
): string[] {
  const condition = p.if;
  const jsCondition = irConditionToJs(condition ?? 'true');
  const lines: string[] = [];

  lines.push(`${indent}{${jsCondition} && (`);
  lines.push(`${indent}  <>`);
  for (const child of node.children || []) {
    lines.push(...renderInkNode(child, `${indent}    `, imports));
  }
  lines.push(`${indent}  </>`);
  lines.push(`${indent})}`);
  return lines;
}

// ── @inkjs/ui Component Renderers (Phase 3) ─────────────────────────────

function renderInkMultiSelect(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInkUI('MultiSelect');
  const rawOptions = p.options;
  const options = isExpr(rawOptions) ? (rawOptions as { code: string }).code : (rawOptions as string) || '[]';
  const onChange = p.onChange as string;
  const msProps: string[] = [`options={${options}}`];
  if (onChange) msProps.push(`onChange={${onChange}}`);
  return [`${indent}<MultiSelect ${msProps.join(' ')} />`];
}

function renderInkConfirmInput(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInkUI('ConfirmInput');
  const ciProps: string[] = [];
  if (p.onConfirm) ciProps.push(`onConfirm={${p.onConfirm}}`);
  if (p.onCancel) ciProps.push(`onCancel={${p.onCancel}}`);
  if (p.defaultChoice) ciProps.push(`defaultChoice="${p.defaultChoice}"`);
  if (p.submitOnEnter === 'false' || p.submitOnEnter === false) ciProps.push('submitOnEnter={false}');
  return [`${indent}<ConfirmInput ${ciProps.join(' ')} />`];
}

function renderInkPasswordInput(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInkUI('PasswordInput');
  const piProps: string[] = [];
  const bind = p.bind as string;
  if (p.placeholder) piProps.push(`placeholder=${JSON.stringify(p.placeholder)}`);
  if (bind) {
    piProps.push(`onChange={set${capitalize(bind)}}`);
  }
  if (p.onChange) piProps.push(`onChange={${p.onChange}}`);
  return [`${indent}<PasswordInput ${piProps.join(' ')} />`];
}

function renderInkStatusMessage(
  node: IRNode,
  p: Record<string, unknown>,
  indent: string,
  imports: ImportTracker,
): string[] {
  imports.addInkUI('StatusMessage');
  const variant = (p.variant as string) || 'info';
  const lines: string[] = [];
  lines.push(`${indent}<StatusMessage variant="${variant}">`);
  for (const child of node.children || []) {
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</StatusMessage>`);
  return lines;
}

function renderInkAlert(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInkUI('Alert');
  const variant = (p.variant as string) || 'info';
  const title = p.title as string;
  const alertProps: string[] = [`variant="${variant}"`];
  if (title) alertProps.push(`title=${JSON.stringify(title)}`);
  const lines: string[] = [];
  lines.push(`${indent}<Alert ${alertProps.join(' ')}>`);
  for (const child of node.children || []) {
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</Alert>`);
  return lines;
}

function renderInkOrderedList(node: IRNode, indent: string, imports: ImportTracker): string[] {
  imports.addInkUI('OrderedList');
  const lines: string[] = [];
  lines.push(`${indent}<OrderedList>`);
  for (const child of node.children || []) {
    lines.push(`${indent}  <OrderedList.Item>`);
    lines.push(...renderInkNode(child, `${indent}    `, imports));
    lines.push(`${indent}  </OrderedList.Item>`);
  }
  lines.push(`${indent}</OrderedList>`);
  return lines;
}

function renderInkUnorderedList(node: IRNode, indent: string, imports: ImportTracker): string[] {
  imports.addInkUI('UnorderedList');
  const lines: string[] = [];
  lines.push(`${indent}<UnorderedList>`);
  for (const child of node.children || []) {
    lines.push(`${indent}  <UnorderedList.Item>`);
    lines.push(...renderInkNode(child, `${indent}    `, imports));
    lines.push(`${indent}  </UnorderedList.Item>`);
  }
  lines.push(`${indent}</UnorderedList>`);
  return lines;
}

function renderInkStaticLog(
  node: IRNode,
  p: Record<string, unknown>,
  indent: string,
  imports: ImportTracker,
): string[] {
  imports.addInk('Static');
  imports.addInk('Text');
  const rawItems = p.items;
  const items = isExpr(rawItems) ? (rawItems as { code: string }).code : (rawItems as string) || '[]';
  const lines: string[] = [];
  lines.push(`${indent}<Static items={${items}}>`);
  lines.push(`${indent}  {(item: any) => (`);
  if (node.children && node.children.length > 1) {
    // Multiple children need a fragment wrapper
    lines.push(`${indent}    <>`);
    for (const child of node.children) {
      lines.push(...renderInkNode(child, `${indent}      `, imports));
    }
    lines.push(`${indent}    </>`);
  } else if (node.children && node.children.length === 1) {
    lines.push(...renderInkNode(node.children[0], `${indent}    `, imports));
  } else {
    lines.push(`${indent}    <Text>{String(item)}</Text>`);
  }
  lines.push(`${indent}  )}`);
  lines.push(`${indent}</Static>`);
  return lines;
}

function renderInkNewline(p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Newline');
  const count = p.count as string;
  if (count && Number(count) > 1) {
    return [`${indent}<Newline count={${count}} />`];
  }
  return [`${indent}<Newline />`];
}

// ── Layout Primitives (Phase 4) ──────────────────────────────────────────

function renderLayoutRow(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  const gap = p.gap as string;
  const padding = p.padding as string;
  const boxProps: string[] = ['flexDirection="row"'];
  if (gap) boxProps.push(`gap={${gap}}`);
  if (padding) boxProps.push(`padding={${padding}}`);
  const lines: string[] = [];
  lines.push(`${indent}<Box ${boxProps.join(' ')}>`);
  for (const child of node.children || []) {
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderLayoutCol(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  const flex = p.flex as string;
  const width = p.width as string;
  const boxProps: string[] = ['flexDirection="column"'];
  if (flex) boxProps.push(`flexGrow={${flex}}`);
  if (width) boxProps.push(`width={${width}}`);
  const lines: string[] = [];
  lines.push(`${indent}<Box ${boxProps.join(' ')}>`);
  for (const child of node.children || []) {
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderLayoutStack(node: IRNode, p: Record<string, unknown>, indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  const padding = p.padding as string;
  const gap = p.gap as string;
  const boxProps: string[] = ['flexDirection="column"'];
  if (padding) boxProps.push(`padding={${padding}}`);
  if (gap) boxProps.push(`gap={${gap}}`);
  const lines: string[] = [];
  lines.push(`${indent}<Box ${boxProps.join(' ')}>`);
  for (const child of node.children || []) {
    lines.push(...renderInkNode(child, `${indent}  `, imports));
  }
  lines.push(`${indent}</Box>`);
  return lines;
}

function renderSpacer(indent: string, imports: ImportTracker): string[] {
  imports.addInk('Box');
  return [`${indent}<Box flexGrow={1} />`];
}

function renderScreenEmbed(p: Record<string, unknown>, indent: string): string[] {
  const screen = p.screen as string;
  if (!screen) return [];
  // Collect all non-screen props as component props
  const propEntries = Object.entries(p).filter(([k]) => k !== 'screen' && k !== 'styles' && k !== 'themeRefs');
  const propsStr = propEntries
    .map(([k, v]) => {
      if (isExpr(v)) return `${k}={${(v as { code: string }).code}}`;
      const s = String(v);
      // Preserve non-string literals as JSX expressions
      if (s === 'true' || s === 'false') return `${k}={${s}}`;
      if (!Number.isNaN(Number(s)) && s !== '') return `${k}={${s}}`;
      return `${k}=${JSON.stringify(s)}`;
    })
    .join(' ');
  return [`${indent}<${screen}${propsStr ? ` ${propsStr}` : ''} />`];
}

// ── Node renderer → JSX (dispatcher) ─────────────────────────────────────

function renderInkNode(node: IRNode, indent: string, imports: ImportTracker): string[] {
  const p = getProps(node);

  switch (node.type) {
    case 'text':
      return renderInkText(p as Record<string, unknown>, indent, imports);
    case 'separator':
      return renderInkSeparator(p as Record<string, unknown>, indent, imports);
    case 'box':
      return renderInkBox(node, p as Record<string, unknown>, indent, imports);
    case 'table':
      return renderInkTable(node, p as Record<string, unknown>, indent, imports);
    case 'scoreboard':
      return renderInkScoreboard(node, p as Record<string, unknown>, indent, imports);
    case 'spinner':
      return renderInkSpinner(p as Record<string, unknown>, indent, imports);
    case 'progress':
      return renderInkProgress(p as Record<string, unknown>, indent, imports);
    case 'gradient':
      return renderInkGradient(p as Record<string, unknown>, indent, imports);
    case 'input-area':
      return renderInkInputArea(node, indent, imports);
    case 'output-area':
      return renderInkOutputArea(node, indent, imports);
    case 'text-input':
      return renderInkTextInput(p as Record<string, unknown>, indent, imports);
    case 'select-input':
      return renderInkSelectInput(p as Record<string, unknown>, indent, imports);
    case 'multi-select':
      return renderInkMultiSelect(p as Record<string, unknown>, indent, imports);
    case 'confirm-input':
      return renderInkConfirmInput(p as Record<string, unknown>, indent, imports);
    case 'password-input':
      return renderInkPasswordInput(p as Record<string, unknown>, indent, imports);
    case 'status-message':
      return renderInkStatusMessage(node, p as Record<string, unknown>, indent, imports);
    case 'alert':
      return renderInkAlert(node, p as Record<string, unknown>, indent, imports);
    case 'ordered-list':
      return renderInkOrderedList(node, indent, imports);
    case 'unordered-list':
      return renderInkUnorderedList(node, indent, imports);
    case 'static-log':
      return renderInkStaticLog(node, p as Record<string, unknown>, indent, imports);
    case 'newline':
      return renderInkNewline(p as Record<string, unknown>, indent, imports);
    case 'layout-row':
      return renderLayoutRow(node, p as Record<string, unknown>, indent, imports);
    case 'layout-col':
      return renderLayoutCol(node, p as Record<string, unknown>, indent, imports);
    case 'layout-stack':
      return renderLayoutStack(node, p as Record<string, unknown>, indent, imports);
    case 'spacer':
      return renderSpacer(indent, imports);
    case 'screen-embed':
      return renderScreenEmbed(p as Record<string, unknown>, indent);
    case 'handler':
      return renderInkHandler(p as Record<string, unknown>, indent);
    case 'each':
      return renderInkEach(node, p as Record<string, unknown>, indent, imports);
    case 'conditional':
      return renderInkConditional(node, p as Record<string, unknown>, indent, imports);
    case 'state':
    case 'ref':
    case 'stream':
    case 'logic':
    case 'callback':
    case 'on':
    case 'animation':
    case 'derive':
    case 'focus':
    case 'app-exit':
      return [];
    default: {
      const lines: string[] = [];
      if (isCoreNode(node.type)) {
        if (node.type === 'machine') {
          lines.push(...generateMachineReducer(node, { safeDispatch: true, emitImport: false }).map((l) => l));
        } else {
          lines.push(...generateCoreNode(node));
        }
        return lines;
      }
      if (node.children) {
        for (const child of node.children) {
          lines.push(...renderInkNode(child, indent, imports));
        }
      }
      return lines;
    }
  }
}

// ── Main export ──────────────────────────────────────────────────────────

export function transpileInk(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  _onHookCounter = 0; // Reset per-component counter
  const sourceMap: SourceMapEntry[] = [];
  const imports = new ImportTracker();
  const lines: string[] = [];

  // Handle file-level AST: find screen node(s), keep siblings as file-level nodes
  const allScreenNodes = root.type === 'screen' ? [root] : (root.children || []).filter((c) => c.type === 'screen');
  const screenNode = allScreenNodes.length > 0 ? allScreenNodes[allScreenNodes.length - 1] : root;
  const fileLevelNodes = root.type === 'screen' ? [] : (root.children || []).filter((c) => c.type !== 'screen');
  // Secondary screens (all except the last/default one)
  const secondaryScreens = allScreenNodes.slice(0, -1);

  const screenProps = getProps(screenNode);
  const screenName = (screenProps.name as string) || 'App';

  // Component props from screen attributes OR prop child nodes
  const propsAttr = screenProps.props as string;
  const propChildren = getChildren(screenNode, 'prop');
  const propParts = propsAttr ? splitPropsRespectingDepth(propsAttr) : [];
  for (const pc of propChildren) {
    const pp = getProps(pc);
    const pName = pp.name as string;
    const pType = (pp.type as string) || 'any';
    const optional = pp.optional === 'true' || pp.optional === true;
    if (pName) propParts.push(`${pName}${optional ? '?' : ''}:${pType}`);
  }
  const propsParam =
    propParts.length > 0
      ? `{ ${propParts.map((p) => p.trim().split(':')[0].replace('?', '').trim()).join(', ')} }: { ${propParts
          .map((p) => {
            const trimmed = p.trim();
            if (trimmed.includes(':')) return trimmed;
            return `${trimmed}: any`;
          })
          .join('; ')} }`
      : '';

  // Separate node categories — search inside the screen node
  const stateNodes = getChildren(screenNode, 'state');
  const refNodes = getChildren(screenNode, 'ref');
  const onNodes = getChildren(screenNode, 'on');
  const streamNodes = getChildren(screenNode, 'stream');
  const logicNodes = [...getChildren(screenNode, 'logic'), ...getChildren(screenNode, 'effect')];
  const callbackNodes = getChildren(screenNode, 'callback');
  const animationNodes = getChildren(screenNode, 'animation');
  const deriveNodes = getChildren(screenNode, 'derive');
  const focusNodes = getChildren(screenNode, 'focus');
  const appExitNodes = getChildren(screenNode, 'app-exit');
  const isInkUiNode = (type: string) =>
    type === 'each' ||
    type === 'conditional' ||
    type === 'select' ||
    type === 'model' ||
    type === 'repository' ||
    type === 'dependency' ||
    type === 'cache';
  // File-level imports go before component; file-level fn/const go after
  const coreChildren = [
    ...fileLevelNodes.filter((c) => isCoreNode(c.type) && c.type !== 'screen' && c.type !== 'fn' && c.type !== 'const'),
    ...(screenNode.children || []).filter((c) => isCoreNode(c.type) && c.type !== 'on' && !isInkUiNode(c.type)),
  ];
  const memoNodes = getChildren(screenNode, 'memo');
  const renderNode = getChildren(screenNode, 'render')[0];
  const uiChildren = (screenNode.children || []).filter(
    (c) =>
      c.type !== 'state' &&
      c.type !== 'ref' &&
      c.type !== 'on' &&
      c.type !== 'stream' &&
      c.type !== 'logic' &&
      c.type !== 'effect' &&
      c.type !== 'callback' &&
      c.type !== 'memo' &&
      c.type !== 'render' &&
      c.type !== 'prop' &&
      c.type !== 'animation' &&
      c.type !== 'derive' &&
      c.type !== 'focus' &&
      c.type !== 'app-exit' &&
      (!isCoreNode(c.type) || isInkUiNode(c.type)),
  );
  const fileLevelFns = fileLevelNodes.filter((c) => c.type === 'fn' || c.type === 'const');

  // Bug #1: Collect nested on-nodes from UI tree and hoist to component level
  const nestedOnNodes = collectNestedOnNodes(screenNode);
  // Deduplicate — top-level on-nodes are already in onNodes
  const allOnNodes = [...onNodes];
  for (const nested of nestedOnNodes) {
    if (!onNodes.includes(nested)) {
      allOnNodes.push(nested);
    }
  }

  // ── Core nodes emitted above component (types, interfaces, machines, events) ──
  const coreLines: string[] = [];
  if (coreChildren.length > 0) {
    coreLines.push('// ── Core ───────────────────────────────────────────────');
    for (const child of coreChildren) {
      if (child.type === 'machine') {
        imports.addReact('useReducer');
        coreLines.push(...generateMachineReducer(child, { safeDispatch: true, emitImport: false }));
      } else if (child.type === 'import') {
        // Merge react/ink imports into tracker to avoid duplicates
        const ip = getProps(child);
        const from = ip.from as string;
        if (from === 'react') {
          const names = ((ip.names as string) || '')
            .split(',')
            .map((n: string) => n.trim())
            .filter(Boolean);
          for (const n of names) imports.addReact(n);
          continue;
        }
        if (from === 'ink') {
          const names = ((ip.names as string) || '')
            .split(',')
            .map((n: string) => n.trim())
            .filter(Boolean);
          for (const n of names) imports.addInk(n);
          continue;
        }
        coreLines.push(...generateCoreNode(child));
      } else {
        coreLines.push(...generateCoreNode(child));
      }
      coreLines.push('');
    }
  }

  // ── Component body ──
  const bodyLines: string[] = [];
  const stateCtx: StateHookContext = { needsInkSafe: false };

  // State hooks
  for (const stateNode of stateNodes) {
    bodyLines.push(...generateStateHook(stateNode, imports, stateCtx));
  }
  if (stateNodes.length > 0) bodyLines.push('');

  // Ref hooks (Feature #10)
  for (const refNode of refNodes) {
    bodyLines.push(...generateRefHook(refNode, imports));
  }
  if (refNodes.length > 0) bodyLines.push('');

  // Focus hooks (Phase 3)
  for (const focusNode of focusNodes) {
    bodyLines.push(...generateFocusHook(focusNode, imports));
  }
  if (focusNodes.length > 0) bodyLines.push('');

  // App exit hooks (Phase 3)
  for (const exitNode of appExitNodes) {
    bodyLines.push(...generateAppExitHook(exitNode, imports));
  }
  if (appExitNodes.length > 0) bodyLines.push('');

  // Memo hooks
  for (const memoNode of memoNodes) {
    const mp = getProps(memoNode);
    const mName = mp.name as string;
    const mDeps = (mp.deps as string) || '';
    const mDepsArr = mDeps ? `[${mDeps}]` : '[]';
    const handlerChild = (memoNode.children || []).find((c: IRNode) => c.type === 'handler');
    const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';
    if (mName && code) {
      imports.addReact('useMemo');
      const dedented = dedent(code);
      bodyLines.push(`  const ${mName} = useMemo(() => {`);
      for (const line of dedented.split('\n')) {
        bodyLines.push(`          ${line}`);
      }
      bodyLines.push(`  }, ${mDepsArr});`);
      bodyLines.push('');
    }
  }

  // Callback hooks (Feature #11)
  for (const callbackNode of callbackNodes) {
    bodyLines.push(...generateCallbackHook(callbackNode, imports));
    bodyLines.push('');
  }

  // on event=key → useInput() hooks (Bug #1: now includes hoisted nested on-nodes)
  for (const onNode of allOnNodes) {
    bodyLines.push(...generateOnHook(onNode, imports));
  }

  // Stream effects → useEffect with async generator iteration
  for (const streamNode of streamNodes) {
    bodyLines.push(...generateStreamEffect(streamNode, imports));
    bodyLines.push('');
  }

  // Logic effects → useEffect (Feature #8)
  for (const logicNode of logicNodes) {
    bodyLines.push(...generateLogicEffect(logicNode, imports));
    bodyLines.push('');
  }

  // Animation effects → useEffect with setInterval (Phase 2)
  for (const animNode of animationNodes) {
    bodyLines.push(...generateAnimation(animNode, imports));
    bodyLines.push('');
  }

  // Derive nodes → useMemo with auto-dep tracking (Phase 2)
  for (const deriveNode of deriveNodes) {
    const dp = getProps(deriveNode);
    const dName = dp.name as string;
    const dExpr = isExpr(dp.expr) ? (dp.expr as { code: string }).code : (dp.expr as string) || '';
    const dDeps = dp.deps as string;
    const dType = dp.type as string;
    if (dName && dExpr) {
      imports.addReact('useMemo');
      const typeAnnotation = dType ? `<${dType}>` : '';
      // Auto-dep tracking: find state names referenced in the expression
      let depsStr: string;
      if (dDeps) {
        depsStr = `[${dDeps}]`;
      } else {
        const stateNames = stateNodes.map((s) => getProps(s).name as string).filter(Boolean);
        const refNames = refNodes
          .map((r) => {
            const rn = getProps(r).name as string;
            return rn ? (rn.endsWith('Ref') ? rn : `${rn}Ref`) : '';
          })
          .filter(Boolean);
        const allNames = [...stateNames, ...refNames];
        const autoDeps = allNames.filter((n) => new RegExp(`\\b${n}\\b`).test(dExpr));
        depsStr = `[${autoDeps.join(', ')}]`;
      }
      bodyLines.push(`  const ${dName} = useMemo${typeAnnotation}(() => ${dExpr}, ${depsStr});`);
      bodyLines.push('');
    }
  }

  // JSX return — use explicit render handler if present, otherwise auto-generate
  if (renderNode) {
    const handlerChild = (renderNode.children || []).find((c: IRNode) => c.type === 'handler');
    const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';
    if (code.trim()) {
      const dedented = dedent(code);
      for (const line of dedented.split('\n')) {
        bodyLines.push(`  ${line}`);
      }
    } else {
      bodyLines.push('  return null;');
    }
  } else {
    imports.addInk('Box');
    bodyLines.push('  return (');
    bodyLines.push('    <Box flexDirection="column">');
    for (const child of uiChildren) {
      bodyLines.push(...renderInkNode(child, '      ', imports));
    }
    bodyLines.push('    </Box>');
    bodyLines.push('  );');
  }

  // ── Assemble ──
  // Note: imports.emit() is deferred to AFTER secondary screens + default component
  // so all required imports are tracked before emission.
  const componentLines: string[] = [];

  // Core nodes
  if (coreLines.length > 0) {
    componentLines.push(...coreLines);
  }

  // Secondary screen components (named exports, Phase 4 composability)
  for (const secScreen of secondaryScreens) {
    const secProps = getProps(secScreen);
    const secName = (secProps.name as string) || 'Component';
    const secPropsAttr = secProps.props as string;
    const secPropChildren = getChildren(secScreen, 'prop');
    const secPropParts = secPropsAttr ? splitPropsRespectingDepth(secPropsAttr) : [];
    for (const pc of secPropChildren) {
      const pp = getProps(pc);
      const pn = pp.name as string;
      const pt = (pp.type as string) || 'any';
      const opt = pp.optional === 'true' || pp.optional === true;
      if (pn) secPropParts.push(`${pn}${opt ? '?' : ''}:${pt}`);
    }
    const secParam =
      secPropParts.length > 0
        ? `{ ${secPropParts.map((p) => p.trim().split(':')[0].replace('?', '').trim()).join(', ')} }: { ${secPropParts
            .map((p) => {
              const t = p.trim();
              return t.includes(':') ? t : `${t}: any`;
            })
            .join('; ')} }`
        : '';
    const secUiChildren = (secScreen.children || []).filter(
      (c) => c.type !== 'state' && c.type !== 'ref' && c.type !== 'prop' && c.type !== 'on',
    );
    const secStateNodes = getChildren(secScreen, 'state');
    const secCtx: StateHookContext = { needsInkSafe: false };

    const secBodyLines: string[] = [];
    for (const sn of secStateNodes) {
      secBodyLines.push(...generateStateHook(sn, imports, secCtx));
    }
    componentLines.push(`export function ${secName}(${secParam}) {`);
    if (secCtx.needsInkSafe) {
      componentLines.push(...emitInkSafePreamble());
    }
    componentLines.push(...secBodyLines);
    imports.addInk('Box');
    componentLines.push('  return (');
    componentLines.push('    <Box flexDirection="column">');
    for (const child of secUiChildren) {
      componentLines.push(...renderInkNode(child, '      ', imports));
    }
    componentLines.push('    </Box>');
    componentLines.push('  );');
    componentLines.push('}');
    componentLines.push('');
  }

  // Component (Feature #9: with props)
  componentLines.push(`export default function ${screenName}(${propsParam}) {`);
  // Emit __inkSafe preamble once if any state uses safe setters
  if (stateCtx.needsInkSafe) {
    componentLines.push(...emitInkSafePreamble());
  }
  componentLines.push(...bodyLines);
  componentLines.push('}');

  // File-level functions/constants emitted after the screen component
  if (fileLevelFns.length > 0) {
    componentLines.push('');
    for (const fn of fileLevelFns) {
      componentLines.push(...generateCoreNode(fn));
      componentLines.push('');
    }
  }

  // NOW emit imports — after all components have populated the tracker
  lines.push(...imports.emit());
  lines.push('');
  lines.push(...componentLines);

  // Source map
  sourceMap.push({
    irLine: root.loc?.line || 0,
    irCol: root.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  const code = lines.join('\n');
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(code);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    diagnostics: (() => {
      const accounted = new Map<IRNode, AccountedEntry>();
      accountNode(accounted, root, 'expressed', undefined, true);
      const CONSUMED = new Set(['state', 'on', 'handler']);
      for (const child of root.children || []) {
        if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', `${child.type} pre-pass`, true);
      }
      return buildDiagnostics(root, accounted, 'ink');
    })(),
  };
}
