import type { IRNode, ResolvedKernConfig } from '@kernlang/core';
import { buildNextjsProfile, buildTailwindProfile, escapeJsString, getProps } from '@kernlang/core';
import { addDefaultImport, addNamedImport, emitImports } from './nextjs-imports.js';
import { renderNode } from './nextjs-renderers.js';
import type { Ctx } from './nextjs-types.js';

/**
 * Detect whether a useState initial value needs lazy initialization.
 * IIFEs and function expressions re-evaluate on every render when passed
 * directly to useState(). Wrapping as useState(() => expr) fixes this.
 */
function needsLazyInit(initial: string, type?: string): boolean {
  const trimmed = initial.trim();
  // IIFE: ((...) => ...)() or (function() { ... })()
  if (/^\(.*\)\s*\(/.test(trimmed)) return true;
  // function expression: function( — executes when called
  if (trimmed.startsWith('function(') || trimmed.startsWith('function (')) return true;
  // new constructor: new Map(), new Set(), etc.
  if (trimmed.startsWith('new ')) return true;
  // Arrow functions: only wrap if state TYPE is a function (state holds a function value)
  if (/^\(?[^)]*\)?\s*=>/.test(trimmed) && type && /=>/.test(type)) return true;
  return false;
}

// ── Ctx factory ─────────────────────────────────────────────────────────

export function createCtx(config?: ResolvedKernConfig): Ctx {
  return {
    lines: [],
    sourceMap: [],
    imports: new Map(),
    componentImports: new Set(),
    isClient: false,
    isAsync: false,
    metadata: null,
    generateMetadataInfo: null,
    fetchCalls: [],
    bodyLines: [],
    stateDecls: [],
    logicBlocks: [],
    colors: config?.colors,
    twProfile: config?.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
    njProfile: config?.frameworkVersions ? buildNextjsProfile(config.frameworkVersions) : undefined,
  };
}

// ── Options for assembleComponentCode ────────────────────────────────────

export interface AssembleOptions {
  /** Component name for the export */
  componentName: string;
  /** Root IR node type (for layout/loading/error detection) */
  rootNodeType: string;
  /** The root node to render children from */
  rootNode: IRNode;
  /**
   * Function to find the state node for a given state name.
   * Used to resolve initial values for useState declarations.
   */
  findStateNode: (name: string) => IRNode | undefined;
  /** Resolved KERN config */
  config?: ResolvedKernConfig;
}

// ── Shared component code assembly ──────────────────────────────────────

/**
 * Assembles the full component code from a populated Ctx.
 * This is the shared logic between _transpileNextjsInner and _renderNextjsFile.
 *
 * Call this AFTER renderNode has populated ctx.lines, ctx.stateDecls, etc.
 */
export function assembleComponentCode(ctx: Ctx, opts: AssembleOptions): string {
  const { componentName, rootNodeType, config } = opts;

  const isLayout = rootNodeType === 'layout';
  const isError = rootNodeType === 'error';

  // If there are fetch calls, mark page as async
  if (ctx.fetchCalls.length > 0) ctx.isAsync = true;

  // Client components cannot be async in Next.js -- client wins, drop server-only patterns
  if (ctx.isClient && ctx.isAsync) {
    ctx.isAsync = false;
    ctx.fetchCalls = [];
  }

  const code: string[] = [];

  // 'use client' directive
  if (ctx.isClient) {
    code.push(`'use client';`);
    code.push('');
  }

  // Metadata type import for generateMetadata
  if (ctx.generateMetadataInfo && !ctx.isClient) {
    addNamedImport(ctx, 'next', 'Metadata', true);
  }

  // Component imports -> add to unified import map (skip if already imported explicitly)
  const uiLib = config?.components?.uiLibrary ?? '@/components/ui';
  const compRoot = config?.components?.componentRoot ?? '@/components';
  if (ctx.componentImports.size > 0) {
    const alreadyImported = new Set<string>();
    for (const spec of ctx.imports.values()) {
      if (spec.defaultImport) alreadyImported.add(spec.defaultImport);
      for (const n of spec.namedImports) alreadyImported.add(n);
    }
    const uiImports = [...ctx.componentImports].filter(
      (c) => ['Icon', 'Button'].includes(c) && !alreadyImported.has(c),
    );
    const others = [...ctx.componentImports].filter((c) => !['Icon', 'Button'].includes(c) && !alreadyImported.has(c));
    for (const name of uiImports) addNamedImport(ctx, uiLib, name);
    for (const name of others) addDefaultImport(ctx, `${compRoot}/${name}`, name);
  }

  // Static metadata needs Metadata type
  if (ctx.metadata && !ctx.generateMetadataInfo) {
    addNamedImport(ctx, 'next', 'Metadata', true);
  }

  // State requires useState import
  if (ctx.stateDecls.length > 0) {
    addNamedImport(ctx, 'react', 'useState');
  }

  // Detect hook imports from logic blocks before emitting imports
  for (const block of ctx.logicBlocks) {
    if (block.includes('useEffect')) addNamedImport(ctx, 'react', 'useEffect');
    if (block.includes('useCallback')) addNamedImport(ctx, 'react', 'useCallback');
    if (block.includes('useMemo')) addNamedImport(ctx, 'react', 'useMemo');
    if (block.includes('useRef')) addNamedImport(ctx, 'react', 'useRef');
  }

  // Emit all imports (unified, sorted)
  code.push(...emitImports(ctx));

  if (code.length > 0 && code[code.length - 1] !== '') code.push('');

  // Metadata export -- static metadata
  if (ctx.metadata) {
    const useSatisfies = ctx.njProfile?.outputRules.metadataStyle === 'satisfies';
    code.push(useSatisfies ? `export const metadata = {` : `export const metadata: Metadata = {`);
    for (const [k, v] of Object.entries(ctx.metadata)) {
      code.push(`  ${k}: '${escapeJsString(v)}',`);
    }
    code.push(useSatisfies ? `} satisfies Metadata;` : `};`);
    code.push('');
  }

  // generateMetadata export (server components only)
  if (ctx.generateMetadataInfo && !ctx.isClient) {
    const usePromiseParams = !ctx.njProfile || ctx.njProfile.major >= 15;
    const paramsType = usePromiseParams
      ? '{ params }: { params: Promise<Record<string, string>> }'
      : '{ params }: { params: Record<string, string> }';
    code.push('');
    code.push(`export async function generateMetadata(${paramsType}): Promise<Metadata> {`);
    if (ctx.generateMetadataInfo.handlerCode) {
      const lines = ctx.generateMetadataInfo.handlerCode
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const line of lines) {
        code.push(`  ${line}`);
      }
    } else {
      if (usePromiseParams) {
        code.push(`  const resolvedParams = await params;`);
        code.push(`  return { title: resolvedParams.slug ?? '' };`);
      } else {
        code.push(`  return { title: params.slug ?? '' };`);
      }
    }
    code.push(`}`);
    code.push('');
  }

  // Component signature
  if (isLayout) {
    code.push(`export default function ${componentName}({ children }: { children: React.ReactNode }) {`);
  } else if (isError) {
    code.push(`export default function ${componentName}({ error, reset }: { error: Error; reset: () => void }) {`);
  } else if (ctx.isAsync) {
    const usePromiseParams = !ctx.njProfile || ctx.njProfile.major >= 15;
    if (usePromiseParams) {
      code.push(`export default async function ${componentName}(props: { params: Promise<Record<string, string>> }) {`);
      code.push(`  const params = await props.params;`);
    } else {
      code.push(`export default async function ${componentName}({ params }: { params: Record<string, string> }) {`);
    }
  } else {
    code.push(`export default function ${componentName}() {`);
  }

  // Emit fetch calls (inside async function body, before return)
  for (const fc of ctx.fetchCalls) {
    if (fc.options) {
      code.push(`  const ${fc.name} = await fetch('${fc.url}', ${fc.options}).then(r => r.json());`);
    } else {
      code.push(`  const ${fc.name} = await fetch('${fc.url}').then(r => r.json());`);
    }
  }

  // Emit useState declarations
  for (const s of ctx.stateDecls) {
    const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
    const stateNode = opts.findStateNode(s.name);
    const initProp = stateNode?.props?.initial;
    const isExprInit = typeof initProp === 'object' && initProp !== null && '__expr' in (initProp as object);
    let initVal: string;
    if (isExprInit) {
      initVal = (initProp as { code: string }).code;
    } else if (s.initial === 'true' || s.initial === 'false') {
      initVal = s.initial;
    } else if (s.initial === '' || s.initial === "''") {
      initVal = "''";
    } else if (!Number.isNaN(Number(s.initial)) && s.initial !== '') {
      initVal = s.initial;
    } else {
      initVal = `'${s.initial}'`;
    }
    // Use lazy initializer for function expressions/IIFEs to avoid re-evaluation per render
    const sType = stateNode?.props?.type as string | undefined;
    const useLazy = needsLazyInit(initVal, sType);
    const finalInit = useLazy ? `() => ${initVal}` : initVal;
    code.push(`  const [${s.name}, ${setter}] = useState(${finalInit});`);
  }

  // Emit logic blocks & detect hook imports
  for (const block of ctx.logicBlocks) {
    code.push(`  ${block}`);
    if (block.includes('useEffect')) addNamedImport(ctx, 'react', 'useEffect');
    if (block.includes('useCallback')) addNamedImport(ctx, 'react', 'useCallback');
    if (block.includes('useMemo')) addNamedImport(ctx, 'react', 'useMemo');
    if (block.includes('useRef')) addNamedImport(ctx, 'react', 'useRef');
  }

  // Emit body lines (notFound, redirect calls)
  for (const line of ctx.bodyLines) {
    code.push(line);
  }

  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  return code.join('\n');
}

// ── Render + assemble convenience ───────────────────────────────────────

/**
 * Full render pipeline: create ctx, render the root node, then assemble code.
 * Used by both flat and structured paths.
 */
export function renderAndAssemble(
  rootNode: IRNode,
  config: ResolvedKernConfig | undefined,
  componentName: string,
  findStateNode: (name: string) => IRNode | undefined,
): { ctx: Ctx; code: string } {
  const ctx = createCtx(config);

  // Check root for client/async flags
  const rootProps = getProps(rootNode);
  if (rootProps.client === 'true' || rootProps.client === true) ctx.isClient = true;
  if (rootProps.async === 'true' || rootProps.async === true) ctx.isAsync = true;

  // Render the IR tree
  renderNode(rootNode, ctx, '    ');

  // Assemble the full component code
  const code = assembleComponentCode(ctx, {
    componentName,
    rootNodeType: rootNode.type,
    rootNode,
    findStateNode,
    config,
  });

  return { ctx, code };
}
