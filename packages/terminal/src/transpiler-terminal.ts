import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig, AccountedEntry } from '@kernlang/core';
import { countTokens, serializeIR, isCoreNode, generateCoreNode, getProps, getChildren, getFirstChild, buildDiagnostics, accountNode } from '@kernlang/core';

/**
 * Terminal Transpiler — generates ANSI-based CLI rendering code
 *
 * Pure Node.js output, no dependencies. Writes escape codes to process.stdout.
 * Handles: text with styles, separator, table, scoreboard, spinner, progress,
 * box, gradient, state blocks, REPL, and parallel dispatch.
 */

// ── ANSI code helpers (generated into output) ────────────────────────────

const ANSI_HELPERS = `
// ── ANSI helpers ──────────────────────────────────────────────────────
const ESC = '\\x1b[';
const RESET = ESC + '0m';
let _activeSpinner = null;

function hexTo256(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
}

function ansiColor(c) {
  if (typeof c === 'number') return ESC + '38;5;' + c + 'm';
  if (typeof c === 'string' && c.startsWith('#')) return ESC + '38;5;' + hexTo256(c) + 'm';
  const named = {
    red: '31', green: '32', yellow: '33', blue: '34',
    cyan: '36', magenta: '35', white: '37', dim: '2', bold: '1', italic: '3',
  };
  return ESC + (named[c] || '37') + 'm';
}

function ansiBg(c) {
  if (typeof c === 'number') return ESC + '48;5;' + c + 'm';
  if (typeof c === 'string' && c.startsWith('#')) return ESC + '48;5;' + hexTo256(c) + 'm';
  const named = {
    red: '41', green: '42', yellow: '43', blue: '44',
    cyan: '46', magenta: '45', white: '47',
  };
  return ESC + (named[c] || '47') + 'm';
}

function style(text, opts) {
  let prefix = '';
  if (opts.bold) prefix += ESC + '1m';
  if (opts.dim) prefix += ESC + '2m';
  if (opts.italic) prefix += ESC + '3m';
  if (opts.color !== undefined) prefix += ansiColor(opts.color);
  if (opts.bg !== undefined) prefix += ansiBg(opts.bg);
  return prefix + text + RESET;
}

function separator(width) {
  return style('─'.repeat(width || 48), { dim: true });
}

function table(headers, rows, colWidths) {
  const widths = colWidths || headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] || '').length)) + 2);
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  const lines = [];
  lines.push(headers.map((h, i) => style(pad(h, widths[i]), { bold: true })).join(''));
  lines.push(style('─'.repeat(widths.reduce((a, b) => a + b, 0)), { dim: true }));
  for (const row of rows) {
    lines.push(row.map((c, i) => pad(c, widths[i])).join(''));
  }
  return lines.join('\\n');
}

function box(content, color, width) {
  color = color || 'white';
  width = width || 50;
  const lines = content.split('\\n');
  const inner = width - 4;
  const top = style('┌' + '─'.repeat(inner + 2) + '┐', { color });
  const bot = style('└' + '─'.repeat(inner + 2) + '┘', { color });
  const mid = lines.map(l => {
    const padded = l + ' '.repeat(Math.max(0, inner - l.length));
    return style('│ ', { color }) + padded + style(' │', { color });
  });
  return [top, ...mid, bot].join('\\n');
}

function gradient(text, colors) {
  if (!colors || colors.length === 0) return text;
  return text.split('').map((ch, i) => {
    const colorIdx = Math.floor((i / text.length) * colors.length);
    return ansiColor(colors[Math.min(colorIdx, colors.length - 1)]) + ch;
  }).join('') + RESET;
}

function spinner(message, color) {
  color = color || 'white';
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  let interval;
  const s = {
    start() {
      _activeSpinner = s;
      interval = setInterval(() => {
        process.stdout.write('\\r' + ansiColor(color) + frames[i % frames.length] + RESET + ' ' + message);
        i++;
      }, 80);
    },
    stop(finalMsg) {
      clearInterval(interval);
      _activeSpinner = null;
      process.stdout.write('\\r' + ' '.repeat(message.length + 4) + '\\r');
      if (finalMsg) console.log(finalMsg);
    },
  };
  return s;
}

function progressBar(value, max, width, color) {
  width = width || 20;
  color = color || 'green';
  const pct = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return ansiColor(color) + '▓'.repeat(filled) + RESET + '░'.repeat(empty) + \` \${Math.round(pct * 100)}%\`;
}

process.on('SIGINT', () => { if (_activeSpinner) _activeSpinner.stop(); process.exit(0); });
`.trim();

// ── State block generator ────────────────────────────────────────────────

function generateStateBlock(stateNode: IRNode): string[] {
  const lines: string[] = [];
  const props = getProps(stateNode);

  // State node from parser: state name=varName initial=value
  const name = props.name as string;
  const initial = props.initial as string;

  if (name && initial !== undefined) {
    const initVal = initial === 'null' ? 'null' : initial === 'true' ? 'true' : initial === 'false' ? 'false' : isNaN(Number(initial)) ? `'${initial}'` : String(initial);
    lines.push(`let ${name} = ${initVal};`);
  } else if (props.styles) {
    // State block with styles syntax: state {key:value}
    const styles = props.styles as Record<string, string>;
    for (const [key, val] of Object.entries(styles)) {
      const initVal = val === 'null' ? 'null' : val === 'true' ? 'true' : val === 'false' ? 'false' : isNaN(Number(val)) ? `'${val}'` : String(val);
      lines.push(`let ${key} = ${initVal};`);
    }
  }

  return lines;
}

// ── Per-node renderers ───────────────────────────────────────────────────

function renderText(p: Record<string, unknown>, indent: string): string[] {
  const value = p.value as string || '';
  const styles = (p.styles as Record<string, string>) || {};
  const styleObj: string[] = [];
  if (styles.c || styles.color) styleObj.push(`color: ${JSON.stringify(styles.c || styles.color)}`);
  if (styles.bg) styleObj.push(`bg: ${JSON.stringify(styles.bg)}`);
  if (styles.fw === 'bold' || styles.bold) styleObj.push('bold: true');
  if (styles.dim) styleObj.push('dim: true');
  if (styles.italic) styleObj.push('italic: true');

  if (styleObj.length > 0) {
    return [`${indent}console.log(style(${JSON.stringify(value)}, { ${styleObj.join(', ')} }));`];
  }
  return [`${indent}console.log(${JSON.stringify(value)});`];
}

function renderSeparator(p: Record<string, unknown>, indent: string): string[] {
  const width = Number(p.width) || 48;
  return [`${indent}console.log(separator(${width}));`];
}

function renderTable(node: IRNode, p: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];
  const headers = p.headers as string || '[]';
  lines.push(`${indent}const _tableHeaders = ${headers};`);
  lines.push(`${indent}const _tableRows: string[][] = [];`);
  for (const row of getChildren(node, 'row')) {
    const rowData = getProps(row).data as string || '[]';
    lines.push(`${indent}_tableRows.push(${rowData});`);
  }
  lines.push(`${indent}console.log(table(_tableHeaders, _tableRows));`);
  return lines;
}

function renderScoreboard(node: IRNode, p: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];
  const title = p.title as string || 'Results';
  const winner = p.winner as string || '';
  lines.push(`${indent}console.log(style(${JSON.stringify(title)}, { bold: true }));`);
  if (winner) {
    lines.push(`${indent}console.log(style('Winner: ${winner}', { color: 'green', bold: true }));`);
  }
  for (const metric of getChildren(node, 'metric')) {
    const mp = getProps(metric);
    const name = mp.name as string || '';
    const values = mp.values as string || '[]';
    lines.push(`${indent}console.log('  ' + style('${name}:', { dim: true }) + ' ' + ${values}.join(' | '));`);
  }
  return lines;
}

function renderSpinner(p: Record<string, unknown>, indent: string): string[] {
  const message = p.message as string || 'Loading...';
  const color = p.color as string || 'white';
  return [
    `${indent}const _spinner = spinner(${JSON.stringify(message)}, ${JSON.stringify(color)});`,
    `${indent}_spinner.start();`,
  ];
}

function renderProgress(p: Record<string, unknown>, indent: string): string[] {
  const value = Number(p.value) || 0;
  const max = Number(p.max) || 100;
  const color = p.color as string || 'green';
  return [`${indent}console.log(progressBar(${value}, ${max}, 20, ${JSON.stringify(color)}));`];
}

function renderBox(node: IRNode, p: Record<string, unknown>, indent: string): string[] {
  const color = p.color as string || 'white';
  const width = Number(p.width) || 50;
  const boxContent: string[] = [];
  for (const child of node.children || []) {
    const cp = getProps(child);
    if (child.type === 'text') {
      boxContent.push(cp.value as string || '');
    } else if (child.type === 'separator') {
      boxContent.push('─'.repeat(Math.min(Number(cp.width) || 40, width - 4)));
    } else if (child.type === 'progress') {
      boxContent.push(`[progress: ${cp.value || 0}/${cp.max || 100}]`);
    } else {
      boxContent.push(`[${child.type}]`);
    }
  }
  return [`${indent}console.log(box(${JSON.stringify(boxContent.join('\\n'))}, ${JSON.stringify(color)}, ${width}));`];
}

function renderGradient(p: Record<string, unknown>, indent: string): string[] {
  const text = p.text as string || '';
  const colors = p.colors as string || '[]';
  return [`${indent}console.log(gradient(${JSON.stringify(text)}, ${colors}));`];
}

function renderHandler(p: Record<string, unknown>, indent: string): string[] {
  const code = p.code as string || '';
  return code.split('\n').map(line => `${indent}${line.trim()}`);
}

// ── Node renderer (dispatch) ─────────────────────────────────────────────

function renderTerminalNode(node: IRNode, indent: string): string[] {
  const p = getProps(node);
  const lines: string[] = [];

  switch (node.type) {
    case 'text': return renderText(p as Record<string, unknown>, indent);
    case 'separator': return renderSeparator(p as Record<string, unknown>, indent);
    case 'table': return renderTable(node, p as Record<string, unknown>, indent);
    case 'scoreboard': return renderScoreboard(node, p as Record<string, unknown>, indent);
    case 'spinner': return renderSpinner(p as Record<string, unknown>, indent);
    case 'progress': return renderProgress(p as Record<string, unknown>, indent);
    case 'box': return renderBox(node, p as Record<string, unknown>, indent);
    case 'gradient': return renderGradient(p as Record<string, unknown>, indent);
    case 'handler': return renderHandler(p as Record<string, unknown>, indent);
    case 'state':
    case 'repl':
      break;
    case 'parallel':
      lines.push(...generateParallelCode(node, indent));
      break;
    default:
      if (isCoreNode(node.type)) {
        lines.push(...generateCoreNode(node).map(l => `${indent}${l}`));
        break;
      }
      if (node.children) {
        for (const child of node.children) {
          lines.push(...renderTerminalNode(child, indent));
        }
      }
  }

  return lines;
}

// ── Parallel code generator ───────────────────────────────────────────────

function generateParallelCode(node: IRNode, indent: string): string[] {
  const p = getProps(node);
  const timeoutSec = Number(p.timeout) || 60;
  const lines: string[] = [];

  // Find each/dispatch children and then block
  const eachNode = (node.children || []).find(c => c.type === 'each');
  const dispatchNodes = getChildren(node, 'dispatch');
  const thenNode = (node.children || []).find(c => c.type === 'then');

  lines.push(`${indent}// ── Parallel dispatch ──────────────────────────`);
  lines.push(`${indent}await (async () => {`);
  lines.push(`${indent}  const _ac = new AbortController();`);
  lines.push(`${indent}  const _timeout = setTimeout(() => _ac.abort(), ${timeoutSec * 1000});`);
  lines.push('');

  if (eachNode) {
    // Pattern: each engine in collection → dispatch
    const ep = getProps(eachNode);
    // "each engine in state.engines" → varName=engine, collection=state.engines
    // Parse from props: name=engine, in=state.engines (or similar)
    const varName = ep.name as string || 'item';
    const collection = (ep.in as string) || '[]';
    const innerDispatch = getFirstChild(eachNode, 'dispatch');

    if (innerDispatch) {
      const dp = getProps(innerDispatch);
      const prompt = dp.prompt as string || 'prompt';
      const resultVar = dp.result as string || 'result';

      // Check for on start/done events (Pattern B)
      const onStartNode = (innerDispatch.children || []).find(c =>
        c.type === 'on' && (getProps(c).name === 'start' || getProps(c).event === 'start')
      );
      const onDoneNode = (innerDispatch.children || []).find(c =>
        c.type === 'on' && (getProps(c).name === 'done' || getProps(c).event === 'done')
      );

      lines.push(`${indent}  const _tasks = (${collection} || []).map(async (${varName}) => {`);

      if (onStartNode) {
        const startHandler = getFirstChild(onStartNode, 'handler');
        const startCode = startHandler ? String(getProps(startHandler).code || '') : '';
        if (startCode) {
          for (const l of startCode.split('\n')) lines.push(`${indent}    ${l.trim()}`);
        }
      }

      lines.push(`${indent}    const ${resultVar} = await dispatch(${varName}, ${prompt}, { signal: _ac.signal });`);

      if (onDoneNode) {
        const doneHandler = getFirstChild(onDoneNode, 'handler');
        const doneCode = doneHandler ? String(getProps(doneHandler).code || '') : '';
        if (doneCode) {
          for (const l of doneCode.split('\n')) lines.push(`${indent}    ${l.trim()}`);
        }
      }

      lines.push(`${indent}    return { ${varName}, ${resultVar} };`);
      lines.push(`${indent}  });`);
    }
  } else if (dispatchNodes.length > 0) {
    // Named dispatch nodes: dispatch engine="claude" → claudeResult
    lines.push(`${indent}  const _tasks = [`);
    for (const dn of dispatchNodes) {
      const dp = getProps(dn);
      const engine = dp.engine as string || 'engine';
      const prompt = dp.prompt as string || 'prompt';
      const resultVar = dp.result as string || `${engine}Result`;

      // Check for on start/done events
      const onStartNode = (dn.children || []).find(c =>
        c.type === 'on' && (getProps(c).name === 'start' || getProps(c).event === 'start')
      );
      const onDoneNode = (dn.children || []).find(c =>
        c.type === 'on' && (getProps(c).name === 'done' || getProps(c).event === 'done')
      );

      lines.push(`${indent}    (async () => {`);

      if (onStartNode) {
        const startHandler = getFirstChild(onStartNode, 'handler');
        const startCode = startHandler ? String(getProps(startHandler).code || '') : '';
        if (startCode) {
          for (const l of startCode.split('\n')) lines.push(`${indent}      ${l.trim()}`);
        }
      }

      lines.push(`${indent}      const ${resultVar} = await dispatch(${JSON.stringify(engine)}, ${prompt}, { signal: _ac.signal });`);

      if (onDoneNode) {
        const doneHandler = getFirstChild(onDoneNode, 'handler');
        const doneCode = doneHandler ? String(getProps(doneHandler).code || '') : '';
        if (doneCode) {
          for (const l of doneCode.split('\n')) lines.push(`${indent}      ${l.trim()}`);
        }
      }

      lines.push(`${indent}      return { engine: ${JSON.stringify(engine)}, result: ${resultVar} };`);
      lines.push(`${indent}    })(),`);
    }
    lines.push(`${indent}  ];`);
  }

  lines.push('');
  lines.push(`${indent}  // Race tasks against timeout — collect whatever finished`);
  lines.push(`${indent}  const _timeoutPromise = new Promise((resolve) => {`);
  lines.push(`${indent}    _ac.signal.addEventListener('abort', () => resolve('timeout'));`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  const _raceResult = await Promise.race([`);
  lines.push(`${indent}    Promise.allSettled(_tasks).then(r => ({ settled: r })),`);
  lines.push(`${indent}    _timeoutPromise.then(() => ({ settled: null })),`);
  lines.push(`${indent}  ]);`);
  lines.push(`${indent}  clearTimeout(_timeout);`);
  lines.push(`${indent}  // On timeout, collect partial results (resolved so far)`);
  lines.push(`${indent}  const _settled = (_raceResult as any).settled || [];`);
  lines.push(`${indent}  const results = _settled`);
  lines.push(`${indent}    .filter((r) => r.status === 'fulfilled')`);
  lines.push(`${indent}    .map((r) => r.value);`);

  // Then block
  if (thenNode) {
    lines.push('');
    // Render then children
    for (const child of thenNode.children || []) {
      lines.push(...renderTerminalNode(child, `${indent}  `));
    }
    // Handler inside then
    const thenHandler = getFirstChild(thenNode, 'handler');
    if (thenHandler) {
      const code = String(getProps(thenHandler).code || '');
      for (const l of code.split('\n')) {
        lines.push(`${indent}  ${l.trim()}`);
      }
    }
  }

  lines.push(`${indent}})();`);
  return lines;
}

// ── Main export ──────────────────────────────────────────────────────────

export function transpileTerminal(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const lines: string[] = [];

  // ANSI helpers
  lines.push(ANSI_HELPERS);
  lines.push('');

  // State blocks
  const stateNodes = getChildren(root, 'state');
  if (stateNodes.length > 0) {
    lines.push('// ── State ──────────────────────────────────────────────');
    for (const stateNode of stateNodes) {
      lines.push(...generateStateBlock(stateNode));
    }
    lines.push('');
  }

  // REPL node detection — generate readline setup
  const replNode = (root.children || []).find(c => c.type === 'repl');

  // Core language nodes (type, interface, fn, machine, etc.) — emit before output
  const coreChildren = (root.children || []).filter(c => isCoreNode(c.type));
  if (coreChildren.length > 0) {
    lines.push('// ── Core ───────────────────────────────────────────────');
    for (const child of coreChildren) {
      lines.push(...generateCoreNode(child));
      lines.push('');
    }
  }

  // Render static nodes (text, separator, box, parallel, etc.) before REPL
  const staticChildren = (root.children || []).filter(c => c.type !== 'state' && c.type !== 'repl' && !isCoreNode(c.type));
  const hasAsync = staticChildren.some(c => c.type === 'parallel');

  if (staticChildren.length > 0) {
    lines.push('// ── Output ─────────────────────────────────────────────');
    if (hasAsync) lines.push('(async () => {');
    const indent = hasAsync ? '  ' : '';
    for (const child of staticChildren) {
      lines.push(...renderTerminalNode(child, indent));
    }
    if (hasAsync) lines.push('})();');
    lines.push('');
  }

  if (replNode) {
    lines.push(...generateReplCode(replNode));
  }

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
      const CONSUMED = new Set(['state', 'repl', 'on', 'handler']);
      for (const child of root.children || []) {
        if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', child.type + ' pre-pass', true);
      }
      return buildDiagnostics(root, accounted, 'terminal');
    })(),
  };
}

// ── REPL generator ───────────────────────────────────────────────────────

function generateReplCode(replNode: IRNode): string[] {
  const p = getProps(replNode);
  const prompt = p.prompt as string || '> ';
  const lines: string[] = [];

  lines.push(`import { createInterface } from 'node:readline';`);
  lines.push('');
  lines.push('// ── REPL ───────────────────────────────────────────────');
  lines.push(`const rl = createInterface({`);
  lines.push(`  input: process.stdin,`);
  lines.push(`  output: process.stdout,`);
  lines.push(`  prompt: ${JSON.stringify(prompt + ' ')},`);
  lines.push(`});`);
  lines.push('');

  // on line handler
  const onLineNode = (replNode.children || []).find(c =>
    c.type === 'on' && ((getProps(c).name || getProps(c).event) === 'line' || (getProps(c).name || getProps(c).event) === 'input')
  );
  if (onLineNode) {
    const handlerNode = getFirstChild(onLineNode, 'handler');
    const handlerCode = handlerNode ? String(getProps(handlerNode).code || '') : '';

    lines.push(`rl.on('line', async (input: string) => {`);
    lines.push(`  const trimmed = input.trim();`);
    lines.push(`  if (!trimmed) { rl.prompt(); return; }`);

    // Guard node — busy check
    const guardNode = (replNode.children || []).find(c => c.type === 'guard');
    if (guardNode) {
      const guardProp = getProps(guardNode);
      const condition = Object.entries(guardProp).find(([k]) => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs');
      if (condition) {
        lines.push(`  if (${condition[0]}) {`);
        // Guard children (text output)
        for (const gc of guardNode.children || []) {
          lines.push(...renderTerminalNode(gc, '    '));
        }
        lines.push(`    rl.prompt(); return;`);
        lines.push(`  }`);
      }
    }

    if (handlerCode) {
      for (const line of handlerCode.split('\n')) {
        lines.push(`  ${line.trim()}`);
      }
    }
    lines.push(`  rl.prompt();`);
    lines.push(`});`);
  }

  // on interrupt handler
  const onInterruptNode = (replNode.children || []).find(c =>
    c.type === 'on' && ((getProps(c).name || getProps(c).event) === 'interrupt' || (getProps(c).name || getProps(c).event) === 'SIGINT')
  );
  if (onInterruptNode) {
    lines.push('');
    lines.push(`rl.on('SIGINT', () => {`);
    for (const child of onInterruptNode.children || []) {
      lines.push(...renderTerminalNode(child, '  '));
    }
    lines.push(`  rl.close();`);
    lines.push(`  process.exit(0);`);
    lines.push(`});`);
  } else {
    lines.push('');
    lines.push(`rl.on('SIGINT', () => { rl.close(); process.exit(0); });`);
  }

  lines.push('');
  lines.push(`rl.prompt();`);

  return lines;
}
