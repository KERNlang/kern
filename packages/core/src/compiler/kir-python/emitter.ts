import type { KernKirValue } from '../../kir-runtime/contracts.js';
import { canonicalJson, sha256 } from '../../kir-runtime/digest.js';
import type {
  LinkedKernKirExpression,
  LinkedKernKirHandler,
  LinkedKernKirParameterType,
  LinkedKernKirProgram,
  LinkedKernKirStatement,
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

function expressionSource(expression: LinkedKernKirExpression, bindings: ReadonlyMap<string, string>): string {
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
      source = `{"tag":"list","value":[${expression.items
        .map((item) => expressionSource(item, bindings))
        .join(',')}]}`;
      break;
    case 'record':
      source = `{"tag":"record","value":[${expression.entries
        .map((entry) => `{"key":${encodedText(entry.key)},"value":${expressionSource(entry.value, bindings)}}`)
        .join(',')}]}`;
      break;
    case 'member':
      source = `_member(${expressionSource(expression.object, bindings)},${expression.optional ? 'True' : 'False'},${encodedText(expression.property)})`;
      break;
    case 'json-call':
      source = `_${expression.operation === 'parse' ? 'json_parse' : 'json_stringify'}_value(${expressionSource(expression.argument, bindings)},_meter)`;
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
): string {
  const suffix = local.slice(2);
  const input =
    statement.input === undefined
      ? `{"presence":"absent"}`
      : `{"presence":"value","value":${expressionSource(statement.input, bindings)}}`;
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

function statementSource(statement: LinkedKernKirStatement, local: string, bindings: Map<string, string>): string {
  if (statement.kind === 'capability') return capabilitySource(statement, local, bindings);
  if (statement.kind === 'let') {
    const value = expressionSource(statement.value, bindings);
    bindings.set(statement.name, local);
    return `        _meter.step()
        _check_abort()
        ${local} = ${value}
`;
  }
  if (statement.kind === 'print') {
    return `        _meter.step()
        _check_abort()
        _printed = ${expressionSource(statement.value, bindings)}
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

function specializedSource(handler: LinkedKernKirHandler, entry: LinkedKernKirProgram['entry']): string {
  const bindings = new Map<string, string>();
  const parameterNames = handler.parameters.map((parameter) => encodedText(parameter.name));
  const parameterLines = handler.parameters.map((parameter, index) => {
    const local = `_k${index.toString(36)}`;
    bindings.set(parameter.name, local);
    return `    ${local} = _request["arguments"].get(_argument_names[${index}])
    if ${local} is None or not _matches(${local}, ${typeSource(parameter.type)}):
        raise _Fault("invalid-handler-arguments", "link")`;
  });
  const body: string[] = [];
  for (let index = 0; index < handler.statements.length; index += 1) {
    const statement = handler.statements[index];
    const local = `_k${(handler.parameters.length + index).toString(36)}`;
    if (statement.kind === 'return') {
      body.push(`        _meter.step()
        _check_abort()
        _returned = ${expressionSource(statement.value, bindings)}
        if not _matches(_returned, ${typeSource(handler.returnType)}):
            raise _Fault("invalid-handler-result", "execution")
        _result = {"presence": "value", "value": _returned}
        _check_abort()
        if _success_bytes(_request["requestId"], _events, _result, _check_abort) > _request["limits"]["maxBytes"]:
            raise _Fault("runtime-limit-exceeded", "execution")
        _check_abort()
        return {"completion": {"kind": "return"}, "diagnostics": [], "events": _events, "format": format, "outcome": "success", "requestId": _request["requestId"], "result": _result}
`);
    } else {
      body.push(statementSource(statement, local, bindings));
    }
  }
  const hasCapability = handler.statements.some((statement) => statement.kind === 'capability');
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
    try:
${body.join('')}        raise _Fault("handler-entry-unsupported", "execution")
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
  const source = `${KERNEL_SOURCE}${specializedSource(program.program, program.entry)}
_manifest_base = ${dataSource(manifestBase)}
with open(__file__, "rb") as _artifact_file:
    _artifact_sha256 = hashlib.sha256(_artifact_file.read()).hexdigest()
manifest = {"artifact": {"path": "entry.py", "sha256": _artifact_sha256}, **_manifest_base}
`;
  return encoder.encode(source);
}
