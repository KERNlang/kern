import type { RunnerClassBinding, RunnerFunctionBinding, RunnerModuleScope } from './ir/semantics/semantic-env.js';
import { parseExpression } from './parser-expression.js';
import type { IRNode } from './types.js';
import type { ValueIR } from './value-ir.js';

const AMBIGUOUS_CLASS = Symbol('ambiguous runner class');
const NON_CLASS = Symbol('non-class runner value');
const FIELD_HANDLER_CACHE = new WeakMap<object, IRNode>();
type ClassBinding = RunnerClassBinding | typeof AMBIGUOUS_CLASS | typeof NON_CLASS;
type ExpressionMode = 'scalar' | 'let' | 'cap';

interface HandlerWork {
  readonly handler: IRNode;
  readonly scope: RunnerModuleScope;
  readonly ownerClass?: RunnerClassBinding;
  readonly receiverClass?: RunnerClassBinding;
  readonly unsupported: boolean;
}

export interface LinkedExecutableHandlers {
  readonly handlers: ReadonlySet<IRNode>;
  readonly unsupported: ReadonlySet<IRNode>;
}

/** Trace exact function and class binding identities through the linked runtime scopes. */
export function linkedExecutableKernHandlers(
  entryHandler: IRNode | undefined,
  rootScope: RunnerModuleScope | undefined,
  ownsClassFrames: boolean,
): LinkedExecutableHandlers {
  const handlers = new Set<IRNode>();
  const unsupported = new Set<IRNode>();
  if (!entryHandler || !rootScope) return { handlers, unsupported };

  const queue: HandlerWork[] = [{ handler: entryHandler, scope: rootScope, unsupported: false }];
  const visited = new Set<string>();
  const identities = new WeakMap<object, number>();
  let nextIdentity = 0;
  const identity = (value: object | undefined): number => {
    if (!value) return 0;
    const existing = identities.get(value);
    if (existing !== undefined) return existing;
    nextIdentity += 1;
    identities.set(value, nextIdentity);
    return nextIdentity;
  };

  const enqueue = (work: HandlerWork): void => {
    queue.push(work);
  };

  while (queue.length > 0) {
    const work = queue.pop();
    if (!work) continue;
    const key = [
      identity(work.handler),
      identity(work.scope),
      identity(work.ownerClass),
      identity(work.receiverClass),
      work.unsupported ? 1 : 0,
    ].join(':');
    if (visited.has(key)) continue;
    visited.add(key);
    handlers.add(work.handler);
    if (work.unsupported) unsupported.add(work.handler);
    scanHandler(work, ownsClassFrames, enqueue);
  }
  return { handlers, unsupported };
}

function scanHandler(work: HandlerWork, ownsClassFrames: boolean, enqueue: (work: HandlerWork) => void): void {
  const classBindings = new Map<string, ClassBinding>();
  for (const node of walkNodes({ type: '__block', children: [...(work.handler.children ?? [])] })) {
    recordClassBinding(node, work.scope, classBindings);
    for (const expression of handlerExpressions(node)) {
      scanExpression(expression.node, expression.mode, work, classBindings, ownsClassFrames, enqueue);
    }
  }
}

function recordClassBinding(node: IRNode, scope: RunnerModuleScope, classBindings: Map<string, ClassBinding>): void {
  if (node.type !== 'let') return;
  const name = typeof node.props?.name === 'string' ? node.props.name : '';
  const raw = typeof node.props?.value === 'string' ? node.props.value : '';
  if (!name || !raw) return;
  try {
    const value = parseExpression(raw);
    if (value.kind === 'new' && value.argument.kind === 'call' && value.argument.callee.kind === 'ident') {
      const cls = scope.classes.get(value.argument.callee.name);
      if (cls) mergeClassBinding(classBindings, name, cls);
    } else if (value.kind === 'call' && value.callee.kind === 'ident' && scope.functions.has(value.callee.name)) {
      mergeClassBinding(classBindings, name, AMBIGUOUS_CLASS);
    } else if (value.kind === 'objectLit' || value.kind === 'arrayLit') {
      mergeClassBinding(classBindings, name, NON_CLASS);
    }
  } catch {
    // Parser and runtime diagnostics own malformed expressions.
  }
}

function mergeClassBinding(bindings: Map<string, ClassBinding>, name: string, value: ClassBinding): void {
  const existing = bindings.get(name);
  if (!existing) bindings.set(name, value);
  else if (existing !== value) bindings.set(name, AMBIGUOUS_CLASS);
}

function scanExpression(
  node: ValueIR,
  mode: ExpressionMode,
  work: HandlerWork,
  classBindings: ReadonlyMap<string, ClassBinding>,
  ownsClassFrames: boolean,
  enqueue: (work: HandlerWork) => void,
): void {
  if (node.kind === 'call' && node.callee.kind === 'ident') {
    const helper = work.scope.functions.get(node.callee.name);
    if (helper) enqueueFunction(helper, work.unsupported, work.scope, enqueue);
  }
  if (node.kind === 'new' && node.argument.kind === 'call' && node.argument.callee.kind === 'ident') {
    const cls = work.scope.classes.get(node.argument.callee.name);
    if (cls) enqueueConstruction(cls, work.unsupported || !ownsClassFrames, enqueue);
  }
  if (node.kind === 'call' && node.callee.kind === 'member') {
    enqueueMember(node.callee.object, node.callee.property, 'method', work, classBindings, ownsClassFrames, enqueue);
  } else if (node.kind === 'member') {
    enqueueMember(node.object, node.property, 'getter', work, classBindings, ownsClassFrames, enqueue);
  }
  for (const child of valueChildren(node, mode, work.scope)) {
    scanExpression(child.node, child.mode, work, classBindings, ownsClassFrames, enqueue);
  }
}

function enqueueFunction(
  binding: RunnerFunctionBinding,
  unsupported: boolean,
  fallbackScope: RunnerModuleScope,
  enqueue: (work: HandlerWork) => void,
): void {
  if (!binding.handler) return;
  enqueue({ handler: binding.handler, scope: binding.module ?? fallbackScope, unsupported });
}

function enqueueConstruction(
  receiver: RunnerClassBinding,
  unsupported: boolean,
  enqueue: (work: HandlerWork) => void,
): void {
  for (const owner of classAncestry(receiver)) {
    const scope = owner.module ?? receiver.module;
    if (!scope) continue;
    for (const field of owner.fields) {
      if (typeof field.value !== 'string' || field.value.trim() === '') continue;
      let fieldHandler = FIELD_HANDLER_CACHE.get(field);
      if (!fieldHandler) {
        fieldHandler = {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'do', props: { value: field.value } }],
        };
        FIELD_HANDLER_CACHE.set(field, fieldHandler);
      }
      enqueue({ handler: fieldHandler, scope, ownerClass: owner, receiverClass: receiver, unsupported });
    }
    if (owner.constructor?.handler) {
      enqueue({
        handler: owner.constructor.handler,
        scope,
        ownerClass: owner,
        receiverClass: receiver,
        unsupported,
      });
    }
  }
}

function enqueueMember(
  object: ValueIR,
  name: string,
  kind: 'getter' | 'method',
  work: HandlerWork,
  classBindings: ReadonlyMap<string, ClassBinding>,
  ownsClassFrames: boolean,
  enqueue: (work: HandlerWork) => void,
): void {
  const resolved = classForObject(object, work, classBindings);
  if (resolved === NON_CLASS) return;
  if (resolved === AMBIGUOUS_CLASS || !resolved) {
    for (const cls of uniqueClasses(work.scope)) {
      enqueueResolvedMember(cls, cls, name, kind, true, enqueue);
    }
    return;
  }
  const { startClass, receiverClass } = resolved;
  enqueueResolvedMember(startClass, receiverClass, name, kind, work.unsupported || !ownsClassFrames, enqueue);
}

function classForObject(
  object: ValueIR,
  work: HandlerWork,
  classBindings: ReadonlyMap<string, ClassBinding>,
):
  | { readonly startClass: RunnerClassBinding; readonly receiverClass: RunnerClassBinding }
  | typeof AMBIGUOUS_CLASS
  | typeof NON_CLASS
  | undefined {
  if (object.kind === 'ident' && object.name === 'this' && work.receiverClass) {
    return { startClass: work.receiverClass, receiverClass: work.receiverClass };
  }
  if (object.kind === 'ident' && object.name === 'super' && work.ownerClass && work.receiverClass) {
    const parent = parentClass(work.ownerClass);
    return parent ? { startClass: parent, receiverClass: work.receiverClass } : undefined;
  }
  if (object.kind === 'ident') {
    const cls = classBindings.get(object.name);
    return cls === AMBIGUOUS_CLASS || cls === NON_CLASS || !cls ? cls : { startClass: cls, receiverClass: cls };
  }
  if (object.kind === 'new' && object.argument.kind === 'call' && object.argument.callee.kind === 'ident') {
    const cls = work.scope.classes.get(object.argument.callee.name);
    return cls ? { startClass: cls, receiverClass: cls } : undefined;
  }
  return AMBIGUOUS_CLASS;
}

function enqueueResolvedMember(
  startClass: RunnerClassBinding,
  receiverClass: RunnerClassBinding,
  name: string,
  kind: 'getter' | 'method',
  unsupported: boolean,
  enqueue: (work: HandlerWork) => void,
): void {
  for (const owner of classAncestry(startClass)) {
    const member = kind === 'method' ? owner.methods.get(name) : owner.getters.get(name);
    if (!member?.handler) continue;
    const scope = owner.module ?? startClass.module;
    if (!scope) return;
    enqueue({ handler: member.handler, scope, ownerClass: owner, receiverClass, unsupported });
    return;
  }
}

function parentClass(cls: RunnerClassBinding): RunnerClassBinding | undefined {
  return cls.extendsName ? cls.module?.classes.get(cls.extendsName) : undefined;
}

function classAncestry(cls: RunnerClassBinding): RunnerClassBinding[] {
  const out: RunnerClassBinding[] = [];
  const seen = new Set<RunnerClassBinding>();
  for (
    let current: RunnerClassBinding | undefined = cls;
    current && !seen.has(current);
    current = parentClass(current)
  ) {
    seen.add(current);
    out.push(current);
  }
  return out;
}

function uniqueClasses(scope: RunnerModuleScope): Set<RunnerClassBinding> {
  return new Set(scope.classes.values());
}

interface HandlerExpression {
  readonly node: ValueIR;
  readonly mode: ExpressionMode;
}

function handlerExpressions(node: IRNode): HandlerExpression[] {
  const props = node.props ?? {};
  const out: HandlerExpression[] = [];
  const add = (raw: unknown, mode: ExpressionMode): void => {
    if (typeof raw !== 'string' || raw.trim() === '') return;
    try {
      out.push({ node: parseExpression(raw), mode });
    } catch {
      // Parser and runtime diagnostics own malformed expressions.
    }
  };
  if (node.type === 'let') add(props.value, 'let');
  else if (node.type === 'capability') add(props.input, 'cap');
  else if (node.type === 'do') add(props.value, 'scalar');
  else if (node.type === 'assign' || node.type === 'print' || node.type === 'return') add(props.value, 'scalar');
  else if (node.type === 'if' || node.type === 'while') add(props.cond, 'scalar');
  else if (node.type === 'fmt' && typeof props.template === 'string') add(`\`${props.template}\``, 'scalar');
  return out;
}

function valueChildren(node: ValueIR, mode: ExpressionMode, scope: RunnerModuleScope): HandlerExpression[] {
  const child = (value: ValueIR, childMode: ExpressionMode = 'scalar'): HandlerExpression => ({
    node: value,
    mode: childMode,
  });
  switch (node.kind) {
    case 'unary':
    case 'spread':
    case 'await':
    case 'propagate':
      return [child(node.argument)];
    case 'binary':
      return [child(node.left), child(node.right)];
    case 'conditional':
      return [child(node.test), child(node.consequent), child(node.alternate)];
    case 'member':
      return [child(node.object)];
    case 'index':
      return [];
    case 'call':
      if (node.callee.kind === 'member') return [child(node.callee.object), ...node.args.map((arg) => child(arg))];
      if (
        node.callee.kind === 'ident' &&
        (scope.functions.has(node.callee.name) || node.callee.name === 'String' || node.callee.name === 'super')
      ) {
        return node.args.map((arg) => child(arg));
      }
      return [];
    case 'new':
      return node.argument.kind === 'call' ? node.argument.args.map((arg) => child(arg)) : [];
    case 'typeAssert':
    case 'nonNull':
      return [child(node.expression)];
    case 'tmplLit':
      return node.expressions.map((expression) => child(expression));
    case 'arrayLit':
      if (mode === 'cap')
        return node.items.filter((item): item is ValueIR => Boolean(item)).map((item) => child(item, 'cap'));
      if (mode === 'let') {
        return node.items
          .filter((item): item is ValueIR => Boolean(item))
          .map((item) => child(item, item.kind === 'arrayLit' ? 'let' : 'scalar'));
      }
      return [];
    case 'objectLit':
      if (mode === 'cap') return node.entries.flatMap((entry) => ('kind' in entry ? [] : [child(entry.value, mode)]));
      if (mode === 'let') {
        return node.entries.flatMap((entry) => ('kind' in entry ? [] : [child(entry.value)]));
      }
      return [];
    default:
      return [];
  }
}

function* walkNodes(root: IRNode): Generator<IRNode> {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    yield node;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
}
