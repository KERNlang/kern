import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';
import type { DecompileResult, ExprObject, IRNode } from './types.js';

function expandKey(key: string): string {
  return STYLE_SHORTHANDS[key] || key;
}

function expandVal(val: string): string {
  return VALUE_SHORTHANDS[val] || val;
}

/**
 * Decompile an IR tree back to a human-readable text representation.
 *
 * Useful for debugging, diffing, and displaying IR to users. Expands style
 * shorthands and value aliases for readability.
 *
 * @param root - The root IRNode to decompile
 * @returns `{ code: string }` — the human-readable representation
 */
export function decompile(root: IRNode): DecompileResult {
  const lines: string[] = [];

  function isExpr(value: unknown): value is ExprObject {
    return typeof value === 'object' && value !== null && (value as ExprObject).__expr === true;
  }

  function renderScalarProp(propName: string, raw: unknown, quoted: string[] = []): string {
    if (isExpr(raw)) return `${propName}={{${raw.code}}}`;
    if (typeof raw === 'boolean' || typeof raw === 'number') return `${propName}=${String(raw)}`;
    const s = String(raw);
    const wasQuoted = quoted.includes(propName);
    const safeBare = !wasQuoted && s !== '' && /^[\w.-]+$/.test(s);
    return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
  }

  function pushHandler(node: IRNode, indent: string): void {
    if (node.props?.lang === 'kern' && (node.children?.length ?? 0) > 0) {
      const quoted = node.__quotedProps ?? [];
      const parts = ['handler'];
      for (const [key, value] of Object.entries(node.props ?? {})) {
        if (key === 'lang' || key === 'code' || value === undefined) continue;
        parts.push(renderScalarProp(key, value, quoted));
      }
      lines.push(`${indent}${parts.join(' ')}`);
      for (const child of node.children ?? []) {
        render(child, `${indent}  `);
      }
      return;
    }

    const code = String(node.props?.code || '');
    lines.push(`${indent}handler <<<`);
    for (const line of code.split('\n')) {
      lines.push(`${indent}  ${line}`);
    }
    lines.push(`${indent}>>>`);
  }

  function render(node: IRNode, indent: string): void {
    if (!node.type) {
      lines.push(`${indent}[unknown node]`);
      return;
    }
    const props = node.props || {};

    if (node.type === 'document') {
      for (const child of node.children || []) render(child, indent);
      return;
    }

    // Canonical-grammar cases — emit re-parseable KERN. Other node types
    // still fall through to the debug-shape serializer below; make them
    // canonical in a follow-up PR.
    if (node.type === 'type') {
      renderType(node, indent);
      return;
    }
    if (node.type === 'interface') {
      renderInterface(node, indent);
      return;
    }
    if (node.type === 'enum') {
      renderEnum(node, indent);
      return;
    }
    if (node.type === 'class' || node.type === 'service') {
      renderClassLike(node, indent);
      return;
    }
    if (
      node.type === 'fn' ||
      node.type === 'method' ||
      node.type === 'constructor' ||
      node.type === 'getter' ||
      node.type === 'setter' ||
      node.type === 'overload'
    ) {
      renderCallable(node, indent);
      return;
    }
    if (node.type === 'const') {
      renderConst(node, indent);
      return;
    }
    if (node.type === 'member') {
      renderMember(node, indent);
      return;
    }
    if (node.type === 'indexer') {
      renderIndexer(node, indent);
      return;
    }
    if (
      node.type === 'corpus' ||
      node.type === 'source' ||
      node.type === 'chunking' ||
      node.type === 'embed' ||
      node.type === 'vectorStore' ||
      node.type === 'ragIndex' ||
      node.type === 'retriever' ||
      node.type === 'retrievalProfile' ||
      node.type === 'rag' ||
      node.type === 'ragRetrieve' ||
      node.type === 'grounding' ||
      node.type === 'ragEval' ||
      node.type === 'ragCase' ||
      node.type === 'ragAssert' ||
      node.type === 'ragAnswerContract' ||
      node.type === 'answerSpan'
    ) {
      renderRagNode(node, indent);
      return;
    }
    if (node.type === 'handler') {
      pushHandler(node, indent);
      return;
    }
    if (node.type === 'doc') {
      renderDoc(node, indent);
      return;
    }
    if (node.type === 'comment') {
      renderComment(node, indent);
      return;
    }
    if (node.type === 'island') {
      renderIsland(node, indent);
      return;
    }
    if (node.type === 'each') {
      renderEach(node, indent);
      return;
    }
    if (node.type === 'let') {
      renderLet(node, indent);
      return;
    }
    if (node.type === 'assign') {
      renderAssign(node, indent);
      return;
    }
    if (node.type === 'cell') {
      renderCell(node, indent);
      return;
    }
    if (node.type === 'set') {
      renderSet(node, indent);
      return;
    }
    if (node.type === 'do') {
      renderDo(node, indent);
      return;
    }
    if (node.type === 'fmt') {
      renderFmt(node, indent);
      return;
    }
    if (node.type === 'return') {
      renderReturn(node, indent);
      return;
    }
    if (node.type === 'if') {
      renderIf(node, indent);
      return;
    }
    if (node.type === 'else') {
      renderElse(node, indent);
      return;
    }
    if (node.type === 'while') {
      renderWhile(node, indent);
      return;
    }
    if (node.type === 'for') {
      renderFor(node, indent);
      return;
    }
    if (node.type === 'with') {
      renderWith(node, indent);
      return;
    }
    if (node.type === 'try') {
      renderTry(node, indent);
      return;
    }
    if (node.type === 'catch') {
      renderCatch(node, indent);
      return;
    }
    if (node.type === 'finally') {
      renderFinally(node, indent);
      return;
    }
    if (node.type === 'throw') {
      renderThrow(node, indent);
      return;
    }
    if (node.type === 'continue' || node.type === 'break') {
      lines.push(`${indent}${node.type}`);
      return;
    }
    if (node.type === 'branch') {
      renderBranch(node, indent);
      return;
    }
    if (node.type === 'path') {
      renderPath(node, indent);
      return;
    }
    if (node.type === 'field') {
      renderField(node, indent);
      return;
    }
    if (node.type === 'param') {
      renderParam(node, indent);
      return;
    }
    if (node.type === 'destructure') {
      renderDestructure(node, indent);
      return;
    }
    if (node.type === 'binding' || node.type === 'element') {
      // Standalone render path — only hit when these appear outside a
      // `destructure` parent. Inside a parent, `renderDestructure` handles
      // them inline.
      renderDestructureChild(node, indent);
      return;
    }
    if (node.type === 'mapLit') {
      renderMapLit(node, indent);
      return;
    }
    if (node.type === 'setLit') {
      renderSetLit(node, indent);
      return;
    }
    if (node.type === 'mapEntry' || node.type === 'setItem') {
      // Children of mapLit/setLit — handled inline by their parent renderer.
      // Standalone render path covers the orphan case for completeness.
      renderMapSetChild(node, indent);
      return;
    }

    const name = (props.name as string) || '';
    const type = node.type.charAt(0).toUpperCase() + node.type.slice(1);

    // Style description
    const styles =
      props.styles && typeof props.styles === 'object' && !Array.isArray(props.styles)
        ? (props.styles as Record<string, string>)
        : undefined;
    const styleDesc = styles
      ? Object.entries(styles)
          .map(([k, v]) => `${expandKey(k)}: ${expandVal(String(v))}`)
          .join(', ')
      : '';

    // Props (excluding internal keys)
    const propEntries = Object.entries(props)
      .filter(([k]) => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs')
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');

    let desc = `${indent}${type}`;
    if (name) desc += ` "${name}"`;
    if (propEntries) desc += ` (${propEntries})`;
    if (styleDesc) desc += ` [${styleDesc}]`;

    const themeRefs = props.themeRefs as string[] | undefined;
    if (themeRefs?.length) desc += ` inherits ${themeRefs.map((r) => `$${r}`).join(', ')}`;

    lines.push(desc);

    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderType(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'UnknownType';
    const parts: string[] = [`type name=${name}`];
    if (props.generics !== undefined) parts.push(renderScalarProp('generics', props.generics, quoted));
    if (props.values !== undefined) parts.push(renderScalarProp('values', props.values, quoted));
    if (props.alias !== undefined) parts.push(renderScalarProp('alias', props.alias, quoted));
    if (props.export === false || props.export === 'false') parts.push('export=false');
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderInterface(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'UnknownInterface';
    const parts: string[] = [`interface name=${name}`];
    if (props.generics !== undefined) parts.push(renderScalarProp('generics', props.generics, quoted));
    if (props.extends !== undefined) parts.push(renderScalarProp('extends', props.extends, quoted));
    if (props.export === false || props.export === 'false') parts.push('export=false');
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderIsland(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'UnknownIsland';
    const parts: string[] = ['island'];
    if (props.kind !== undefined) parts.push(String(props.kind));
    parts.push(name);
    for (const key of [
      'runtime',
      'protocol',
      'module',
      'args',
      'session',
      'options',
      'error',
      'timeout',
      'effects',
      'serialization',
      'requiresSidecar',
      'version',
      'review',
      'reason',
    ]) {
      if (props[key] !== undefined) parts.push(renderScalarProp(key, props[key], quoted));
    }
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderEnum(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'UnknownEnum';
    const parts: string[] = [`enum name=${name}`];
    if (props.values !== undefined) parts.push(renderScalarProp('values', props.values, quoted));
    if (props.const === true || props.const === 'true') parts.push('const=true');
    if (props.export === false || props.export === 'false') parts.push('export=false');
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderMember(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'member';
    const parts: string[] = [`member name=${name}`];
    if (props.value !== undefined) parts.push(renderScalarProp('value', props.value, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
  }

  function renderIndexer(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts: string[] = ['indexer'];
    if (props.keyName !== undefined) parts.push(renderScalarProp('keyName', props.keyName, quoted));
    if (props.keyType !== undefined) parts.push(renderScalarProp('keyType', props.keyType, quoted));
    if (props.type !== undefined) parts.push(renderScalarProp('type', props.type, quoted));
    if (props.readonly === true || props.readonly === 'true') parts.push('readonly=true');
    lines.push(`${indent}${parts.join(' ')}`);
  }

  function renderRagNode(node: IRNode, indent: string): void {
    const propOrderByType: Record<string, string[]> = {
      corpus: ['name', 'title', 'tenant', 'refresh'],
      source: ['name', 'kind', 'uri', 'resource', 'media', 'acl'],
      chunking: ['name', 'corpus', 'source', 'strategy', 'maxTokens', 'overlap', 'unit'],
      embed: ['name', 'corpus', 'model', 'dims', 'metric'],
      vectorStore: ['name', 'kind', 'dims', 'metric', 'path', 'url', 'table', 'namespace'],
      ragIndex: ['name', 'corpus', 'store', 'embed', 'chunking', 'refresh'],
      retriever: ['name', 'corpus', 'embed', 'mode', 'topK', 'minScore', 'rerank'],
      retrievalProfile: [
        'name',
        'queryParam',
        'queryTemplate',
        'topK',
        'minScore',
        'filterCorpus',
        'filterSource',
        'filterUri',
        'filterPath',
        'filterChunking',
        'output',
        'requireCitations',
      ],
      rag: ['name', 'retriever', 'prompt', 'answer', 'citations'],
      ragRetrieve: [
        'name',
        'index',
        'indexes',
        'profile',
        'rag',
        'queryParam',
        'queryTemplate',
        'query',
        'as',
        'topK',
        'minScore',
        'filterCorpus',
        'filterSource',
        'filterUri',
        'filterPath',
        'filterChunking',
        'output',
        'requireCitations',
      ],
      grounding: ['name', 'rag', 'requireCitations', 'policy', 'maxContext'],
      ragEval: ['name', 'rag', 'metric', 'threshold', 'mode'],
      ragCase: ['name', 'query', 'tags', 'topK', 'minScore', 'chunkCount', 'sources'],
      ragAssert: ['kind', 'value', 'threshold', 'count', 'valueMs', 'required'],
      ragAnswerContract: ['name', 'rag', 'query', 'answer', 'prompt', 'requireCitations', 'minGroundingCoverage'],
      answerSpan: ['start', 'end', 'chunks', 'required'],
    };
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = [node.type];
    for (const propName of propOrderByType[node.type] ?? []) {
      if (props[propName] !== undefined) parts.push(renderScalarProp(propName, props[propName], quoted));
    }
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderClassLike(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || (node.type === 'service' ? 'UnknownService' : 'UnknownClass');
    const parts: string[] = [`${node.type} name=${name}`];
    if (props.generics !== undefined) parts.push(renderScalarProp('generics', props.generics, quoted));
    if (props.extends !== undefined) parts.push(renderScalarProp('extends', props.extends, quoted));
    if (props.implements !== undefined) parts.push(renderScalarProp('implements', props.implements, quoted));
    if (props.abstract === true || props.abstract === 'true') parts.push('abstract=true');
    if (props.export === false || props.export === 'false') parts.push('export=false');
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderCallable(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts: string[] = [];
    if (node.type === 'constructor') {
      parts.push('constructor');
    } else if (node.type === 'overload') {
      parts.push('overload');
    } else {
      parts.push(`${node.type} name=${(props.name as string) || node.type}`);
    }

    if (props.generics !== undefined) parts.push(renderScalarProp('generics', props.generics, quoted));
    if (props.params !== undefined) parts.push(renderScalarProp('params', props.params, quoted));
    if (props.returns !== undefined) parts.push(renderScalarProp('returns', props.returns, quoted));
    if (props.async === true || props.async === 'true') parts.push('async=true');
    if (props.stream === true || props.stream === 'true') parts.push('stream=true');
    if (props.generator === true || props.generator === 'true') parts.push('generator=true');
    if (props.static === true || props.static === 'true') parts.push('static=true');
    if (props.private === true || props.private === 'true') parts.push('private=true');
    if (props.export === false || props.export === 'false') parts.push('export=false');
    if (props.expr !== undefined) parts.push(renderScalarProp('expr', props.expr, quoted));

    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderConst(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'unknownConst';
    const parts: string[] = [`const name=${name}`];
    if (props.type !== undefined) parts.push(renderScalarProp('type', props.type, quoted));
    if (props.value !== undefined) parts.push(renderScalarProp('value', props.value, quoted));
    if (props.export === false || props.export === 'false') parts.push('export=false');
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children || []) render(child, `${indent}  `);
  }

  function renderDoc(node: IRNode, indent: string): void {
    const text = String(node.props?.text || node.props?.code || '');
    if (!text.includes('\n')) {
      lines.push(`${indent}doc text=${JSON.stringify(text)}`);
      return;
    }
    lines.push(`${indent}doc <<<`);
    for (const line of text.split('\n')) {
      lines.push(`${indent}  ${line}`);
    }
    lines.push(`${indent}>>>`);
  }

  function renderComment(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['comment'];
    if (props.raw !== undefined) parts.push(renderScalarProp('raw', props.raw, quoted));
    if (props.text !== undefined) parts.push(renderScalarProp('text', props.text, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
  }

  function renderLet(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'binding';
    // Codex hold #3: prefer `value=` if the let node carries one (slice 3a).
    // Without this, a let authored with `value=42` would round-trip to
    // `expr=""` and lose its assignment entirely.
    const rawValue = props.value;
    const rawExpr = props.expr;
    const t = props.type as string | undefined;
    const parts: string[] = [`let name=${name}`];
    if (rawValue !== undefined) {
      const valueText =
        typeof rawValue === 'object' && (rawValue as ExprObject).__expr
          ? `{{${(rawValue as ExprObject).code}}}`
          : JSON.stringify(rawValue as string);
      parts.push(`value=${valueText}`);
    } else {
      const exprBody =
        rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
          ? (rawExpr as ExprObject).code
          : (rawExpr as string) || '';
      // Uninitialised `let` (migrated from TS `let x;`) carries neither
      // `value` nor `expr` — emit a bare `let name=x` rather than a
      // spurious `expr=""` that the round-trip would have to special-case
      // back to no-initialiser semantics.
      if (exprBody !== '') parts.push(`expr=${JSON.stringify(exprBody)}`);
    }
    // Gemini review fix: types with spaces (`User | null`) or operators
    // need quoting — bare-word emission breaks the parser. `renderScalarProp`
    // applies the same quote-when-unsafe rule the other type-bearing
    // decompilers already use.
    if (t !== undefined) parts.push(renderScalarProp('type', t, quoted));
    if (props.kind === 'let') parts.push('kind=let');
    lines.push(`${indent}${parts.join(' ')}`);
    // `let` has no children in normal use, but preserve generic recursion.
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderAssign(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const op = typeof props.op === 'string' ? props.op : '';
    const isPostfix = op === '++' || op === '--';
    const parts = ['assign', renderScalarProp('target', props.target ?? '', quoted)];
    if (op !== '' && op !== '=') parts.push(renderScalarProp('op', op, quoted));
    if (!isPostfix) parts.push(renderScalarProp('value', props.value ?? '', quoted));
    lines.push(`${indent}${parts.join(' ')}`);
  }

  function renderCell(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['cell', renderScalarProp('name', props.name ?? '', quoted)];
    if (props.initial !== undefined) parts.push(renderScalarProp('initial', props.initial, quoted));
    if (props.type !== undefined) parts.push(renderScalarProp('type', props.type, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
  }

  function renderSet(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    lines.push(
      `${indent}set ${renderScalarProp('name', props.name ?? '', quoted)} ${renderScalarProp('to', props.to ?? '', quoted)}`,
    );
  }

  function renderDo(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    lines.push(`${indent}do ${renderScalarProp('value', props.value ?? '', quoted)}`);
  }

  function renderFmt(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['fmt'];
    if (props.name !== undefined) parts.push(renderScalarProp('name', props.name, quoted));
    if (props.template !== undefined) parts.push(renderScalarProp('template', props.template, quoted));
    if (props.type !== undefined) parts.push(renderScalarProp('type', props.type, quoted));
    if (props.export !== undefined) parts.push(renderScalarProp('export', props.export, quoted));
    if (props.return !== undefined) parts.push(renderScalarProp('return', props.return, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
  }

  function renderReturn(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    if (props.value === undefined || props.value === '') {
      lines.push(`${indent}return`);
      return;
    }
    lines.push(`${indent}return ${renderScalarProp('value', props.value, quoted)}`);
  }

  function renderIf(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    lines.push(`${indent}if ${renderScalarProp('cond', props.cond ?? '', quoted)}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderElse(node: IRNode, indent: string): void {
    lines.push(`${indent}else`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderWhile(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    lines.push(`${indent}while ${renderScalarProp('cond', props.cond ?? '', quoted)}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderFor(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    if (props.name === undefined || props.from === undefined || props.to === undefined) {
      throw new Error('Cannot decompile `for` without required `name=`, `from=`, and `to=` props.');
    }
    const parts = [
      'for',
      renderScalarProp('name', props.name, quoted),
      renderScalarProp('from', props.from, quoted),
      renderScalarProp('to', props.to, quoted),
    ];
    if (props.step !== undefined && props.step !== '') parts.push(renderScalarProp('step', props.step, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderWith(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    if (props.name === undefined || props.value === undefined || props.cleanup === undefined) {
      throw new Error('Cannot decompile `with` without required `name=`, `value=`, and `cleanup=` props.');
    }
    const parts = [
      'with',
      renderScalarProp('name', props.name, quoted),
      renderScalarProp('value', props.value, quoted),
      renderScalarProp('cleanup', props.cleanup, quoted),
    ];
    if (props.async === true || props.async === 'true') parts.push('async=true');
    if (props.protocol !== undefined && props.protocol !== '') {
      parts.push(renderScalarProp('protocol', props.protocol, quoted));
    }
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderTry(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['try'];
    if (props.name !== undefined) parts.push(renderScalarProp('name', props.name, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderCatch(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['catch'];
    if (props.name !== undefined) parts.push(renderScalarProp('name', props.name, quoted));
    if (props.type !== undefined) parts.push(renderScalarProp('type', props.type, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderFinally(node: IRNode, indent: string): void {
    lines.push(`${indent}finally`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderThrow(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    if (props.value === undefined || props.value === '') {
      lines.push(`${indent}throw`);
      return;
    }
    lines.push(`${indent}throw ${renderScalarProp('value', props.value, quoted)}`);
  }

  function renderBranch(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['branch'];
    if (props.name !== undefined) parts.push(renderScalarProp('name', props.name, quoted));
    if (props.on !== undefined) parts.push(renderScalarProp('on', props.on, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderPath(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts = ['path'];
    if (props.value !== undefined) parts.push(renderScalarProp('value', props.value, quoted));
    if (props.default !== undefined) parts.push(renderScalarProp('default', props.default, quoted));
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children ?? []) render(child, `${indent}  `);
  }

  function renderField(node: IRNode, indent: string): void {
    // Slice 3b: emit `field` re-parseably so canonical `value={{...}}` forms
    // survive the IR → text round-trip. Without this, the generic JSON.stringify
    // path would emit `value={"__expr":true,"code":"foo()"}` for any class field
    // imported from TS — un-re-parseable.
    //
    // String prop emission honours __quotedProps so a bare `value=42` (numeric
    // literal) round-trips as bare and codegens to `42`, whereas a quoted
    // `value="42"` round-trips quoted and codegens to `"42"` (string literal).
    // Without this distinction, all bare values would gain spurious quotes on
    // every decompile + re-parse cycle.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'field';
    const parts: string[] = [`field name=${name}`];

    function renderStringProp(propName: string, raw: string | ExprObject): string {
      if (typeof raw === 'object' && (raw as ExprObject).__expr) {
        return `${propName}={{${(raw as ExprObject).code}}}`;
      }
      const s = raw as string;
      // Bare-emit only when the source was unquoted AND the value matches a
      // strict whitelist of identifier-shape characters (alphanumeric, `_`,
      // `.`, `-`). Codex hold #2: a permissive blacklist (e.g. `/[\s=]/`)
      // would emit values like `'draft'|'done'` or `{id:string}` bare, which
      // the parser then truncates at the embedded quote or treats as a
      // style block. The whitelist covers numeric literals, identifiers, and
      // dotted member chains — the cases ValueIR canonicalises — and forces
      // JSON.stringify on anything else (type unions, object shorthands,
      // strings with punctuation, etc.).
      const wasQuoted = quoted.includes(propName);
      const safeBare = !wasQuoted && s !== '' && /^[\w.-]+$/.test(s);
      return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) parts.push(renderStringProp('type', t));
    const opt = props.optional;
    if (opt === true || opt === 'true') parts.push('optional=true');
    const priv = props.private;
    if (priv === true || priv === 'true') parts.push('private=true');
    const ro = props.readonly;
    if (ro === true || ro === 'true') parts.push('readonly=true');
    const stat = props.static;
    if (stat === true || stat === 'true') parts.push('static=true');

    const rawValue = props.value as string | ExprObject | undefined;
    const rawDefault = props.default as string | ExprObject | undefined;
    if (rawValue !== undefined) {
      parts.push(renderStringProp('value', rawValue));
    } else if (rawDefault !== undefined) {
      parts.push(renderStringProp('default', rawDefault));
    }

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderParam(node: IRNode, indent: string): void {
    // Slice 3c: emit `param` re-parseably so canonical `value={{...}}` forms
    // (and ValueIR-canonicalised bare values) survive IR → text round-trip.
    // Mirrors renderField — same __quotedProps-aware bare/quoted policy.
    //
    // `param` is used in two contexts: (a) MCP tool/resource/prompt params
    // (description/required/min/max apply); (b) fn/method/constructor
    // parameter defaults via slice 3c (value/default apply). Both share this
    // emitter so a node round-trips correctly regardless of parent context.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    // Slice 3c-extension #3: destructured params omit `name=`; the LHS pattern
    // is encoded in `binding`/`element` children. Detect by child presence so
    // round-trips of importer-emitted destructured params don't gain a bogus
    // `name=param` attribute that would re-parse to a `param name="param"`.
    const hasDestructure = (node.children ?? []).some((c) => c.type === 'binding' || c.type === 'element');
    const name = props.name as string | undefined;
    const parts: string[] = ['param'];
    if (!hasDestructure && name) parts[0] = `param name=${name}`;
    else if (!hasDestructure) parts[0] = 'param name=param';

    function renderStringProp(propName: string, raw: string | ExprObject): string {
      if (typeof raw === 'object' && (raw as ExprObject).__expr) {
        return `${propName}={{${(raw as ExprObject).code}}}`;
      }
      const s = raw as string;
      // Bare-emit only when source was unquoted AND value matches the
      // identifier-shape whitelist (mirrors renderField — see Codex hold #2).
      const wasQuoted = quoted.includes(propName);
      const safeBare = !wasQuoted && s !== '' && /^[\w.-]+$/.test(s);
      return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) parts.push(renderStringProp('type', t));
    const required = props.required;
    if (required === true || required === 'true') parts.push('required=true');
    // Slice 3c-extension: TS-style optional `?` round-trips via `optional=true`.
    const optional = props.optional;
    if (optional === true || optional === 'true') parts.push('optional=true');
    // Slice 3c-extension: TS-style variadic `...` round-trips via `variadic=true`.
    const variadic = props.variadic;
    if (variadic === true || variadic === 'true') parts.push('variadic=true');

    const rawValue = props.value as string | ExprObject | undefined;
    const rawDefault = props.default as string | ExprObject | undefined;
    if (rawValue !== undefined) {
      parts.push(renderStringProp('value', rawValue));
    } else if (rawDefault !== undefined) {
      parts.push(renderStringProp('default', rawDefault));
    }

    const description = props.description;
    if (typeof description === 'string') parts.push(`description=${JSON.stringify(description)}`);
    const min = props.min;
    if (min !== undefined) parts.push(`min=${min}`);
    const max = props.max;
    if (max !== undefined) parts.push(`max=${max}`);

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderDestructure(node: IRNode, indent: string): void {
    // Slice 3d: emit `destructure` re-parseably so structured `binding`/
    // `element` children plus the `expr={{...}}` escape hatch survive
    // IR → text round-trip. Mirrors renderParam's __quotedProps-aware
    // bare-vs-quoted policy on `source`.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts: string[] = ['destructure'];

    // Escape-hatch path: raw statement carried verbatim. When present, all
    // other props are ignored (codegen also ignores them — see generateDestructure).
    const rawExpr = props.expr as string | ExprObject | undefined;
    if (rawExpr !== undefined) {
      if (typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr) {
        parts.push(`expr={{${(rawExpr as ExprObject).code}}}`);
      } else {
        parts.push(`expr=${JSON.stringify(rawExpr)}`);
      }
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }

    const kind = props.kind as string | undefined;
    if (kind && kind !== 'const') parts.push(`kind=${kind}`);

    const t = props.type as string | undefined;
    if (t !== undefined) {
      const wasQuoted = quoted.includes('type');
      const safeBare = !wasQuoted && /^[\w.<>[\]|&,\s-]+$/.test(t) && !/\s/.test(t.trim());
      parts.push(`type=${safeBare ? t : JSON.stringify(t)}`);
    }

    const rawSource = props.source as string | ExprObject | undefined;
    if (rawSource !== undefined) {
      if (typeof rawSource === 'object' && (rawSource as ExprObject).__expr) {
        parts.push(`source={{${(rawSource as ExprObject).code}}}`);
      } else {
        const s = rawSource as string;
        const wasQuoted = quoted.includes('source');
        const safeBare = !wasQuoted && /^[\w.-]+$/.test(s);
        parts.push(`source=${safeBare ? s : JSON.stringify(s)}`);
      }
    }

    const exported = props.export;
    if (exported === true || exported === 'true') parts.push('export=true');

    lines.push(`${indent}${parts.join(' ')}`);

    if (node.children) {
      for (const child of node.children) {
        renderDestructureChild(child, `${indent}  `);
      }
    }
  }

  function renderDestructureChild(node: IRNode, indent: string): void {
    const props = node.props || {};
    const name = (props.name as string) || '?';
    if (node.type === 'binding') {
      const parts: string[] = [`binding name=${name}`];
      const key = props.key as string | undefined;
      if (key) parts.push(`key=${key}`);
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    if (node.type === 'element') {
      const parts: string[] = [`element name=${name}`];
      const idx = props.index;
      if (idx !== undefined) parts.push(`index=${idx}`);
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    // Unknown — should never hit; fall through to generic render.
    render(node, indent);
  }

  function renderMapLit(node: IRNode, indent: string): void {
    // Slice 3e: emit `mapLit` re-parseably with `mapEntry` children inline.
    // Mirrors renderDestructure escape-hatch + __quotedProps policy.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'unknownMap';
    const parts: string[] = [`mapLit name=${name}`];

    // Escape-hatch path — raw statement carried verbatim. Other props ignored.
    const rawExpr = props.expr as string | ExprObject | undefined;
    if (rawExpr !== undefined) {
      const exprText =
        typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
          ? `{{${(rawExpr as ExprObject).code}}}`
          : JSON.stringify(rawExpr);
      lines.push(`${indent}mapLit name=${name} expr=${exprText}`);
      return;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) {
      const wasQuoted = quoted.includes('type');
      const safeBare = !wasQuoted && /^[\w.<>[\]|&,\s-]+$/.test(t) && !/\s/.test(t.trim());
      parts.push(`type=${safeBare ? t : JSON.stringify(t)}`);
    }
    const kind = props.kind as string | undefined;
    if (kind && kind !== 'const') parts.push(`kind=${kind}`);
    if (props.export === true || props.export === 'true') parts.push('export=true');

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        renderMapSetChild(child, `${indent}  `);
      }
    }
  }

  function renderSetLit(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'unknownSet';
    const parts: string[] = [`setLit name=${name}`];

    const rawExpr = props.expr as string | ExprObject | undefined;
    if (rawExpr !== undefined) {
      const exprText =
        typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
          ? `{{${(rawExpr as ExprObject).code}}}`
          : JSON.stringify(rawExpr);
      lines.push(`${indent}setLit name=${name} expr=${exprText}`);
      return;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) {
      const wasQuoted = quoted.includes('type');
      const safeBare = !wasQuoted && /^[\w.<>[\]|&,\s-]+$/.test(t) && !/\s/.test(t.trim());
      parts.push(`type=${safeBare ? t : JSON.stringify(t)}`);
    }
    const kind = props.kind as string | undefined;
    if (kind && kind !== 'const') parts.push(`kind=${kind}`);
    if (props.export === true || props.export === 'true') parts.push('export=true');

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        renderMapSetChild(child, `${indent}  `);
      }
    }
  }

  function renderMapSetChild(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];

    function renderExprProp(propName: string, raw: unknown): string {
      if (typeof raw === 'object' && raw !== null && (raw as ExprObject).__expr) {
        return `${propName}={{${(raw as ExprObject).code}}}`;
      }
      const s = raw as string;
      const wasQuoted = quoted.includes(propName);
      const safeBare = !wasQuoted && typeof s === 'string' && s !== '' && /^[\w.-]+$/.test(s);
      return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
    }

    if (node.type === 'mapEntry') {
      const key = props.key;
      const val = props.value;
      const parts: string[] = ['mapEntry'];
      if (key !== undefined) parts.push(renderExprProp('key', key));
      if (val !== undefined) parts.push(renderExprProp('value', val));
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    if (node.type === 'setItem') {
      const val = props.value;
      const parts: string[] = ['setItem'];
      if (val !== undefined) parts.push(renderExprProp('value', val));
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    render(node, indent);
  }

  function renderEach(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const rawIn = props.in;
    const inExpr =
      rawIn && typeof rawIn === 'object' && (rawIn as ExprObject).__expr
        ? (rawIn as ExprObject).code
        : (rawIn as string) || '';
    const pairKey = (props.pairKey as string) || '';
    const pairValue = (props.pairValue as string) || '';
    const isAwait = props.await === true || props.await === 'true';
    // 2026-05-06 — pair-mode round-trip. When both pairKey and pairValue are
    // present, emit `each pairKey=k pairValue=v in=...` and omit `name=`
    // (which is optional in this form per the conditional-required rule).
    if (pairKey && pairValue) {
      const parts: string[] = [`each pairKey=${pairKey}`, `pairValue=${pairValue}`, `in=${JSON.stringify(inExpr)}`];
      if (isAwait) parts.push('await=true');
      lines.push(`${indent}${parts.join(' ')}`);
      if (node.children) {
        for (const child of node.children) {
          render(child, `${indent}  `);
        }
      }
      return;
    }
    const name = (props.name as string) || 'item';
    const index = (props.index as string) || '';
    const rawKey = props.key;
    const keyExpr =
      rawKey && typeof rawKey === 'object' && (rawKey as ExprObject).__expr
        ? (rawKey as ExprObject).code
        : typeof rawKey === 'string'
          ? rawKey
          : '';

    const parts: string[] = [`each name=${name}`, `in=${JSON.stringify(inExpr)}`];
    if (index) parts.push(`index=${index}`);
    if (props.type !== undefined) parts.push(renderScalarProp('type', props.type, quoted));
    if (isAwait) parts.push('await=true');
    if (keyExpr) parts.push(`key=${JSON.stringify(keyExpr)}`);
    lines.push(`${indent}${parts.join(' ')}`);

    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  render(root, '');
  return { code: lines.join('\n') };
}
