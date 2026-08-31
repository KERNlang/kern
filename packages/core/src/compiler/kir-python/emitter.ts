import type { KernKirValue } from '../../kir-runtime/contracts.js';
import { sha256 } from '../../kir-runtime/digest.js';
import type {
  LinkedKernKirExpression,
  LinkedKernKirHandler,
  LinkedKernKirHelper,
  LinkedKernKirParameterType,
  LinkedKernKirProgram,
  LinkedKernKirStatement,
} from '../../kir-runtime/linked-kir-program/index.js';
import {
  LINKED_KIR_BINARY_OPERATORS,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability,
} from '../../kir-runtime/linked-kir-program/index.js';
import { TARGET_BASE_SOURCE } from './target-base.js';
import { TARGET_EXECUTION_SOURCE } from './target-execution.js';
import { TARGET_JSON_SOURCE } from './target-json.js';

const encoder = new TextEncoder();
const KERNEL_SOURCE = `${TARGET_BASE_SOURCE}${TARGET_JSON_SOURCE}${TARGET_EXECUTION_SOURCE}`;

export const TARGET_KERNEL_SHA256 = sha256(KERNEL_SOURCE);

export interface TargetManifestBase {
  readonly artifactFormat: string;
  readonly canonicalization: string;
  readonly compilerFormat: string;
  readonly compilerRequestSha256: string;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly hashAlgorithm: string;
  readonly hostProfile: string;
  readonly kernelSha256: string;
  readonly linkedProgramSha256: string;
  readonly projectionArtifactSha256: string;
  readonly runtimeFormat: string;
}

function encodedText(value: string): string {
  return `_chars([${Array.from(value, (character) => character.codePointAt(0) as number).join(',')}])`;
}

function valueSource(value: KernKirValue): string {
  switch (value.tag) {
    case 'null':
      return `{"tag":"null"}`;
    case 'boolean':
      return `{"tag":"boolean","value":${value.value ? 'True' : 'False'}}`;
    case 'text':
    case 'integer':
    case 'decimal':
      return `{"tag":${encodedText(value.tag)},"value":${encodedText(value.value)}}`;
    case 'list':
      return `{"tag":"list","value":[${value.value.map(valueSource).join(',')}]}`;
    case 'record':
      return `{"tag":"record","value":[${value.value
        .map((entry) => `{"key":${encodedText(entry.key)},"value":${valueSource(entry.value)}}`)
        .join(',')}]}`;
  }
}

type CallLocals = ReadonlyMap<string, string>;

function expressionSource(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, string>,
  calls: CallLocals,
): string {
  let source: string;
  switch (expression.kind) {
    case 'literal':
      source = valueSource(expression.value);
      break;
    case 'identifier': {
      const binding = bindings.get(expression.name);
      if (binding === undefined) throw new Error('linked expression references a missing binding');
      source = binding;
      break;
    }
    case 'list':
      source = `{"tag":"list","value":[${expression.items.map((item) => expressionSource(item, bindings, calls)).join(',')}]}`;
      break;
    case 'record':
      source = `{"tag":"record","value":[${expression.entries
        .map((entry) => `{"key":${encodedText(entry.key)},"value":${expressionSource(entry.value, bindings, calls)}}`)
        .join(',')}]}`;
      break;
    case 'user-call': {
      const helper = calls.get(expression.handlerName);
      if (helper === undefined) throw new Error('linked expression references a missing helper');
      source = `${helper}(${expression.arguments.map((argument) => expressionSource(argument, bindings, calls)).join(',')})`;
      break;
    }
    case 'binary': {
      const operator = LINKED_KIR_BINARY_OPERATORS[expression.op];
      const left = expressionSource(expression.left, bindings, calls);
      const right = expressionSource(expression.right, bindings, calls);
      source =
        operator.family === 'logical'
          ? `${operator.pythonHelper}(${left},lambda:${right})`
          : `${operator.pythonHelper}(${left},${right})`;
      break;
    }
    case 'member':
      source = `_member(${expressionSource(expression.object, bindings, calls)},${expression.optional ? 'True' : 'False'},${encodedText(expression.property)})`;
      break;
    case 'json-call':
      source = `_${expression.operation === 'parse' ? 'json_parse' : 'json_stringify'}_value(${expressionSource(expression.argument, bindings, calls)},_meter)`;
      break;
  }
  return `_expression(_meter,lambda:${source})`;
}

function typeSource(type: LinkedKernKirParameterType): string {
  return type.kind === 'list'
    ? `{"kind":"list","element":${encodedText(type.element)}}`
    : `{"kind":${encodedText(type.kind)}}`;
}

function capabilitySource(
  statement: Extract<LinkedKernKirStatement, { kind: 'capability' }>,
  local: string,
  bindings: Map<string, string>,
  calls: CallLocals,
): string {
  const suffix = local.slice(2);
  const input =
    statement.input === undefined
      ? `{"presence":"absent"}`
      : `{"presence":"value","value":${expressionSource(statement.input, bindings, calls)}}`;
  bindings.set(statement.name, local);
  return `        _meter.step()
        _check_abort()
        _input${suffix} = ${input}
        if len(_events) + 1 > _request["limits"]["maxEvents"]:
            raise _Fault("runtime-limit-exceeded", "execution")
        try:
            _raw${suffix} = await _invoke_capability(
                _options["invoke"],
                {"namespace": ${encodedText(statement.namespace)}, "operation": ${encodedText(statement.operation)}, "input": _input${suffix}, "signal": _internal},
                _internal, _deadline, _reason, _sync_external,
            )
        except _Fault:
            raise
        except Exception:
            raise _Fault("capability-error", "execution")
        _check_abort()
        try:
            _slot${suffix} = _inspect_slot(_raw${suffix}, _meter)
        except _Fault as _error:
            if _error.code == "runtime-limit-exceeded":
                raise
            raise _Fault("invalid-handler-result", "execution")
        if _slot${suffix}["presence"] != "value":
            raise _Fault("invalid-handler-result", "execution")
        _check_abort()
        _events.append({"input": _input${suffix}, "namespace": ${encodedText(statement.namespace)}, "op": "capability", "operation": ${encodedText(statement.operation)}, "result": _slot${suffix}})
        ${local} = _slot${suffix}["value"]
`;
}

function indented(source: string): string {
  return source
    .split('\n')
    .map((line) => (line === '' ? line : `    ${line}`))
    .join('\n');
}

function leafSource(
  statement: LinkedKernKirStatement,
  local: string,
  bindings: Map<string, string>,
  calls: CallLocals,
): string {
  if (statement.kind === 'capability') return capabilitySource(statement, local, bindings, calls);
  if (statement.kind === 'let') {
    const value = expressionSource(statement.value, bindings, calls);
    bindings.set(statement.name, local);
    return `        _meter.step()
        _check_abort()
        ${local} = ${value}
`;
  }
  if (statement.kind === 'print') {
    return `        _meter.step()
        _check_abort()
        _printed = ${expressionSource(statement.value, bindings, calls)}
        if _printed["tag"] != "text":
            raise _Fault("unsupported-runtime-input", "execution")
        if len(_events) + 1 > _request["limits"]["maxEvents"]:
            raise _Fault("runtime-limit-exceeded", "execution")
        _check_abort()
        _events.append({"op": "stdout", "text": _printed["value"]})
`;
  }
  throw new Error('return statements are emitted by the specialized handler');
}

function blockSource(
  statements: readonly LinkedKernKirStatement[],
  scope: Map<string, string>,
  calls: CallLocals,
  nextLocal: () => string,
  returnSource: (value: string) => string,
): string {
  return statements
    .map((statement) => {
      if (statement.kind === 'return') return returnSource(expressionSource(statement.value, scope, calls));
      if (statement.kind !== 'if') return leafSource(statement, nextLocal(), scope, calls);
      const local = nextLocal();
      const condition = expressionSource(statement.condition, scope, calls);
      const thenSource = indented(blockSource(statement.thenBranch, new Map(scope), calls, nextLocal, returnSource));
      const elseSource =
        statement.elseBranch === undefined
          ? ''
          : `        else:\n${indented(blockSource(statement.elseBranch, new Map(scope), calls, nextLocal, returnSource))}`;
      return `        _meter.step()
        _check_abort()
        ${local} = ${condition}
        if ${local}["tag"] != "boolean":
            raise _Fault("unsupported-runtime-input", "execution")
        if ${local}["value"] is True:
${thenSource}${elseSource}`;
    })
    .join('');
}

function helperSource(helper: LinkedKernKirHelper, local: string, calls: CallLocals): string {
  const scope = new Map<string, string>();
  const parameters = helper.handler.parameters.map((parameter, index) => {
    const name = `${local}p${index.toString(36)}`;
    scope.set(parameter.name, name);
    return name;
  });
  const guards = helper.handler.parameters.map(
    (parameter, index) => `        if not _matches(${parameters[index]}, ${typeSource(parameter.type)}):
            raise _Fault("unsupported-runtime-input", "execution")
`,
  );
  const locals: string[] = [];
  const nextLocal = (): string => {
    const name = `${local}k${locals.length.toString(36)}`;
    locals.push(name);
    return name;
  };
  const returnSource = (value: string): string => `        _check_abort()
        ${local}r = ${value}
        if not _matches(${local}r, ${typeSource(helper.handler.returnType)}):
            raise _Fault("unsupported-runtime-input", "execution")
        return ${local}r
`;
  const body = blockSource(helper.handler.statements, scope, calls, nextLocal, returnSource);
  return `    def ${local}(${parameters.join(', ')}):
        _meter.step()
${guards.join('')}${body}        raise _Fault("handler-entry-unsupported", "execution")

`;
}

function specializedSource(
  handler: LinkedKernKirHandler,
  entry: LinkedKernKirProgram['entry'],
  helpers: readonly LinkedKernKirHelper[] | undefined,
): string {
  const calls = new Map<string, string>(
    (helpers ?? []).map((helper, index) => [helper.name, `_f${index.toString(36)}`]),
  );
  const helperSources = (helpers ?? []).map((helper, index) => helperSource(helper, `_f${index.toString(36)}`, calls));
  const bindings = new Map<string, string>();
  const parameterNames = handler.parameters.map((parameter) => encodedText(parameter.name));
  const parameterLines = handler.parameters.map((parameter, index) => {
    const local = `_k${index.toString(36)}`;
    bindings.set(parameter.name, local);
    return `    ${local} = _request["arguments"].get(_argument_names[${index}])
    if ${local} is None or not _matches(${local}, ${typeSource(parameter.type)}):
        raise _Fault("invalid-handler-arguments", "link")`;
  });
  const statementLocals: string[] = [];
  const nextLocal = (): string => {
    const local = `_k${(handler.parameters.length + statementLocals.length).toString(36)}`;
    statementLocals.push(local);
    return local;
  };
  const returnSource = (value: string): string => `        _meter.step()
        _check_abort()
        _returned = ${value}
        if not _matches(_returned, ${typeSource(handler.returnType)}):
            raise _Fault("invalid-handler-result", "execution")
        _result = {"presence": "value", "value": _returned}
        _check_abort()
        if _success_bytes(_request["requestId"], _events, _result, _check_abort) > _request["limits"]["maxBytes"]:
            raise _Fault("runtime-limit-exceeded", "execution")
        _check_abort()
        return {"completion": {"kind": "return"}, "diagnostics": [], "events": _events, "format": format, "outcome": "success", "requestId": _request["requestId"], "result": _result}
`;
  const body = blockSource(handler.statements, bindings, calls, nextLocal, returnSource);
  const hasCapability = linkedStatementsInvokeCapability(handler.statements, linkedProgramHelpers(helpers));
  return `

async def _run_specialized(_request, _options, _meter, _deadline, _events):
    _argument_names = [${parameterNames.join(',')}]
    if sorted(_request["arguments"]) != sorted(_argument_names):
        raise _Fault("invalid-handler-arguments", "link")
${parameterLines.join('\n')}
    if ${hasCapability ? 'True' : 'False'} and "invoke" not in _options:
        raise _Fault("capability-error", "execution")
    _external = _options.get("signal")
    if _request["control"]["preCancelled"] or (_external is not None and _external.is_set()):
        raise _Fault("execution-cancelled", "execution")
    _internal = asyncio.Event()
    _reason = {"value": None}

    def _sync_external():
        if _external is not None and _external.is_set() and not _internal.is_set():
            _reason["value"] = "cancelled"
            _internal.set()

    def _check_abort():
        _deadline.check()
        _sync_external()
        if _internal.is_set():
            raise _Fault("execution-timeout" if _reason["value"] == "timeout" else "execution-cancelled", "execution")

    async def _watch_external():
        await _external.wait()
        _sync_external()

    _watcher = None if _external is None else asyncio.create_task(_watch_external())
${helperSources.join('')}    try:
${body}        raise _Fault("handler-entry-unsupported", "execution")
    finally:
        if _watcher is not None and not _watcher.done():
            _watcher.cancel()


async def execute(input, execution_options=None):
    _deadline = _Deadline(input)
    _request_id = _request_id_from(input)
    _events = []
    try:
        _deadline.check()
        _request, _meter = _inspect_request(input, _deadline.check)
        _options = _inspect_options(execution_options)
        if _request["entry"] != {"moduleId": ${encodedText(entry.moduleId)}, "handlerName": ${encodedText(entry.handlerName)}}:
            raise _Fault("handler-entry-not-found", "link")
        _deadline.check()
        return await _run_specialized(_request, _options, _meter, _deadline, _events)
    except Exception as _error:
        return _failure_envelope(_request_id, _error, _events)
`;
}

function dataSource(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return encodedText(value);
  if (Array.isArray(value)) return `[${value.map(dataSource).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${encodedText(key)}:${dataSource(record[key])}`)
    .join(',')}}`;
}

export function emitPython(program: LinkedKernKirProgram, manifestBase: TargetManifestBase): Uint8Array {
  const source = `${KERNEL_SOURCE}${specializedSource(program.program, program.entry, program.helpers)}
_manifest_base = ${dataSource(manifestBase)}
with open(__file__, "rb") as _artifact_file:
    _artifact_sha256 = hashlib.sha256(_artifact_file.read()).hexdigest()
manifest = {"artifact": {"path": "entry.py", "sha256": _artifact_sha256}, **_manifest_base}
`;
  return encoder.encode(source);
}
