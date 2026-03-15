import type { IRNode, TranspileResult, SourceMapEntry, GeneratedArtifact } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { countTokens, serializeIR } from './utils.js';

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

// ── Types ────────────────────────────────────────────────────────────────

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function getChildren(node: IRNode, type: string): IRNode[] {
  return (node.children || []).filter(c => c.type === type);
}

function getFirstChild(node: IRNode, type: string): IRNode | undefined {
  return (node.children || []).find(c => c.type === type);
}

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

// ── Node renderer ────────────────────────────────────────────────────────

function renderTerminalNode(node: IRNode, indent: string): string[] {
  const p = getProps(node);
  const lines: string[] = [];

  switch (node.type) {
    case 'text': {
      const value = p.value as string || '';
      const styles = (p.styles as Record<string, string>) || {};
      const styleObj: string[] = [];
      if (styles.c || styles.color) styleObj.push(`color: ${JSON.stringify(styles.c || styles.color)}`);
      if (styles.bg) styleObj.push(`bg: ${JSON.stringify(styles.bg)}`);
      if (styles.fw === 'bold' || styles.bold) styleObj.push('bold: true');
      if (styles.dim) styleObj.push('dim: true');
      if (styles.italic) styleObj.push('italic: true');

      if (styleObj.length > 0) {
        lines.push(`${indent}console.log(style(${JSON.stringify(value)}, { ${styleObj.join(', ')} }));`);
      } else {
        lines.push(`${indent}console.log(${JSON.stringify(value)});`);
      }
      break;
    }

    case 'separator': {
      const width = Number(p.width) || 48;
      lines.push(`${indent}console.log(separator(${width}));`);
      break;
    }

    case 'table': {
      const headers = p.headers as string || '[]';
      lines.push(`${indent}const _tableHeaders = ${headers};`);
      lines.push(`${indent}const _tableRows: string[][] = [];`);
      for (const row of getChildren(node, 'row')) {
        const rowData = getProps(row).data as string || '[]';
        lines.push(`${indent}_tableRows.push(${rowData});`);
      }
      lines.push(`${indent}console.log(table(_tableHeaders, _tableRows));`);
      break;
    }

    case 'scoreboard': {
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
      break;
    }

    case 'spinner': {
      const message = p.message as string || 'Loading...';
      const color = p.color as string || 'white';
      lines.push(`${indent}const _spinner = spinner(${JSON.stringify(message)}, ${JSON.stringify(color)});`);
      lines.push(`${indent}_spinner.start();`);
      break;
    }

    case 'progress': {
      const value = Number(p.value) || 0;
      const max = Number(p.max) || 100;
      const color = p.color as string || 'green';
      lines.push(`${indent}console.log(progressBar(${value}, ${max}, 20, ${JSON.stringify(color)}));`);
      break;
    }

    case 'box': {
      const color = p.color as string || 'white';
      const width = Number(p.width) || 50;
      // Box content from all children (recursive)
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
      lines.push(`${indent}console.log(box(${JSON.stringify(boxContent.join('\\n'))}, ${JSON.stringify(color)}, ${width}));`);
      break;
    }

    case 'gradient': {
      const text = p.text as string || '';
      const colors = p.colors as string || '[]';
      lines.push(`${indent}console.log(gradient(${JSON.stringify(text)}, ${colors}));`);
      break;
    }

    case 'handler': {
      const code = p.code as string || '';
      for (const line of code.split('\n')) {
        lines.push(`${indent}${line.trim()}`);
      }
      break;
    }

    case 'state':
      // Handled at top level
      break;

    case 'repl':
      // Handled at top level
      break;

    case 'parallel':
      lines.push(...generateParallelCode(node, indent));
      break;

    default:
      // Recurse into children for unknown nodes
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
      lines.push(`${indent}    (async () => {`);
      lines.push(`${indent}      const ${resultVar} = await dispatch(${JSON.stringify(engine)}, ${prompt}, { signal: _ac.signal });`);
      lines.push(`${indent}      return { engine: ${JSON.stringify(engine)}, result: ${resultVar} };`);
      lines.push(`${indent}    })(),`);
    }
    lines.push(`${indent}  ];`);
  }

  lines.push('');
  lines.push(`${indent}  let _results;`);
  lines.push(`${indent}  try {`);
  lines.push(`${indent}    _results = await Promise.race([`);
  lines.push(`${indent}      Promise.allSettled(_tasks),`);
  lines.push(`${indent}      new Promise((_, reject) => {`);
  lines.push(`${indent}        _ac.signal.addEventListener('abort', () => reject(new Error('Parallel timeout')));`);
  lines.push(`${indent}      }),`);
  lines.push(`${indent}    ]);`);
  lines.push(`${indent}  } catch {`);
  lines.push(`${indent}    _results = await Promise.allSettled(_tasks);`);
  lines.push(`${indent}  } finally {`);
  lines.push(`${indent}    clearTimeout(_timeout);`);
  lines.push(`${indent}  }`);
  lines.push('');
  lines.push(`${indent}  const results = _results`);
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

  // Render static nodes (text, separator, box, parallel, etc.) before REPL
  const staticChildren = (root.children || []).filter(c => c.type !== 'state' && c.type !== 'repl');
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
