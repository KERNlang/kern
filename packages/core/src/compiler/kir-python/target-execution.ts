export const TARGET_EXECUTION_SOURCE = String.raw`

def _matches(value, expected):
    if expected["kind"] != "list":
        return value["tag"] == expected["kind"]
    return value["tag"] == "list" and all(item["tag"] == expected["element"] for item in value["value"])


def _slot_text(slot, check):
    if slot["presence"] == "absent":
        return '{"presence":"absent"}'
    return '{"presence":"value","value":' + _encode_value(slot["value"], check) + "}"


def _success_bytes(request_id, events, result, check):
    encoded = []
    for event in events:
        check()
        if event["op"] == "stdout":
            encoded.append('{"op":"stdout","text":' + _quote(event["text"], check) + "}")
        else:
            encoded.append(
                '{"input":' + _slot_text(event["input"], check)
                + ',"namespace":' + _quote(event["namespace"], check)
                + ',"op":"capability","operation":' + _quote(event["operation"], check)
                + ',"result":' + _slot_text(event["result"], check) + "}"
            )
    text = (
        '{"completion":{"kind":"return"},"diagnostics":[],"events":[' + ",".join(encoded)
        + '],"format":"kern.runtime.kir.v1","outcome":"success","requestId":' + _quote(request_id, check)
        + ',"result":' + _slot_text(result, check) + "}"
    )
    return _utf8(text, check)


def _failure_envelope(request_id, error, events):
    cause = error if isinstance(error, _Fault) else _Fault("handler-link-error", "link")
    return {
        "completion": {"kind": "error"},
        "diagnostics": [{"category": "runtime", "code": cause.code, "phase": cause.phase}],
        "events": list(events),
        "format": format,
        "outcome": "failure",
        "requestId": request_id,
        "result": {"presence": "absent"},
    }


def _consume_task(task):
    try:
        task.exception()
    except BaseException:
        pass


async def _invoke_capability(invoke, call, internal_signal, deadline, reason, sync_external):
    if internal_signal.is_set():
        deadline.check()
        raise _Fault("execution-timeout" if reason["value"] == "timeout" else "execution-cancelled", "execution")
    try:
        raw = invoke(call)
    except asyncio.CancelledError:
        raise _Fault("capability-error", "execution")
    if not hasattr(raw, "__await__"):
        sync_external()
        return raw
    provider_task = asyncio.ensure_future(raw)
    provider_task.add_done_callback(_consume_task)
    interrupted = asyncio.create_task(internal_signal.wait())
    try:
        done, _pending = await asyncio.wait(
            {provider_task, interrupted},
            timeout=deadline.remaining(),
            return_when=asyncio.FIRST_COMPLETED,
        )
        sync_external()
        if provider_task in done and not internal_signal.is_set():
            try:
                return provider_task.result()
            except asyncio.CancelledError:
                raise _Fault("capability-error", "execution")
        if provider_task not in done:
            if interrupted not in done:
                reason["value"] = "timeout"
                internal_signal.set()
            provider_task.cancel()
            await asyncio.sleep(0)
        deadline.check()
        raise _Fault("execution-timeout" if reason["value"] == "timeout" else "execution-cancelled", "execution")
    finally:
        if not provider_task.done():
            provider_task.cancel()
        if not interrupted.done():
            interrupted.cancel()


def _operand_fault():
    raise _Fault("unsupported-runtime-input", "execution", "KIR_BINARY_OPERAND_TYPE")


def _bool_operand(operand):
    if operand["tag"] != "boolean":
        _operand_fault()
    return operand


def _int_operand(operand):
    if operand["tag"] != "integer":
        _operand_fault()
    return int(operand["value"])


def _bool_value(flag):
    return {"tag": "boolean", "value": flag}


def _and(left, right):
    if _bool_operand(left)["value"] is False:
        return left
    return _bool_operand(right())


def _or(left, right):
    if _bool_operand(left)["value"] is True:
        return left
    return _bool_operand(right())


def _same_operands(left, right):
    if left["tag"] != right["tag"]:
        _operand_fault()
    if left["tag"] == "boolean":
        return left["value"] is right["value"]
    if left["tag"] == "integer":
        return int(left["value"]) == int(right["value"])
    _operand_fault()


def _eq(left, right):
    return _bool_value(_same_operands(left, right))


def _ne(left, right):
    return _bool_value(not _same_operands(left, right))


def _lt(left, right):
    return _bool_value(_int_operand(left) < _int_operand(right))


def _le(left, right):
    return _bool_value(_int_operand(left) <= _int_operand(right))


def _gt(left, right):
    return _bool_value(_int_operand(left) > _int_operand(right))


def _ge(left, right):
    return _bool_value(_int_operand(left) >= _int_operand(right))


def _int_value(value):
    return {"tag": "integer", "value": str(value)}


def _add(left, right):
    return _int_value(_int_operand(left) + _int_operand(right))


def _sub(left, right):
    return _int_value(_int_operand(left) - _int_operand(right))


def _mul(left, right):
    return _int_value(_int_operand(left) * _int_operand(right))


def _neg(operand):
    return _int_value(-_int_operand(operand))


def _expression(meter, thunk):
    meter.step()
    return thunk()


def _chars(points):
    return "".join(chr(point) for point in points)
`;
