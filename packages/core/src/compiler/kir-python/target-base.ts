export const TARGET_BASE_SOURCE = String.raw`import asyncio
import hashlib
import re
import sys
import time

format = "kern.runtime.kir.v1"
_SAFE_INTEGER = 9007199254740991
_IDENTIFIER = r"^[A-Za-z_$][A-Za-z0-9_$]*$"
_INTEGER = r"^(?:0|-?[1-9][0-9]*)$"
_DECIMAL = r"^-?(?:0|[1-9][0-9]*)\.[0-9]+$"
_LIMIT_KEYS = {
    "maxBytes", "maxCollectionLength", "maxDepth", "maxDiagnostics",
    "maxEvents", "maxSteps", "maxStringBytes",
}


class _Fault(Exception):
    def __init__(self, code, phase, label=None):
        super().__init__(code if label is None else label)
        self.code = code
        self.phase = phase


def _bad():
    raise _Fault("invalid-handler-arguments", "link")


def _plain(value):
    if type(value) is not dict:
        _bad()
    return dict(value)


def _exact(value, keys):
    if set(value) != set(keys) or len(value) != len(keys):
        _bad()


def _positive(value):
    if type(value) is not int or value < 1 or value > _SAFE_INTEGER:
        _bad()
    return value


def _utf8(value, check=lambda: None):
    size = 0
    for index, character in enumerate(value):
        if index & 1023 == 0:
            check()
        point = ord(character)
        if 0xD800 <= point <= 0xDFFF:
            _bad()
        if point <= 0x7F:
            size += 1
        elif point <= 0x7FF:
            size += 2
        elif point <= 0xFFFF:
            size += 3
        else:
            size += 4
    return size


def _required_text(value, meter):
    if type(value) is not str or not value:
        _bad()
    return meter.text(value)


def _quote(value, check=lambda: None):
    output = ['"']
    escapes = {"\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
    for index, character in enumerate(value):
        if index & 1023 == 0:
            check()
        point = ord(character)
        if character in {'"', "\\"}:
            output.append("\\" + character)
        elif character in escapes:
            output.append(escapes[character])
        elif point < 0x20:
            output.append(f"\\u{point:04x}")
        else:
            output.append(character)
    output.append('"')
    return "".join(output)


def _data_text(value):
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if type(value) is str:
        return _quote(value)
    if type(value) is list:
        return "[" + ",".join(_data_text(item) for item in value) + "]"
    return "{" + ",".join(_quote(key) + ":" + _data_text(value[key]) for key in value) + "}"


class _Deadline:
    def __init__(self, value):
        timeout = None
        if type(value) is dict and type(value.get("control")) is dict:
            candidate = value["control"].get("timeoutMs")
            if type(candidate) is int and 1 <= candidate <= 2147483647:
                timeout = candidate
        self.expires_at = None if timeout is None else time.monotonic() + timeout / 1000

    def remaining(self):
        return None if self.expires_at is None else max(0, self.expires_at - time.monotonic())

    def check(self):
        if self.expires_at is not None and time.monotonic() >= self.expires_at:
            raise _Fault("execution-timeout", "execution")


class _Meter:
    def __init__(self, limits, check=lambda: None):
        self.limits = limits
        self.check_interruption = check
        self.steps = 0

    def check(self):
        self.check_interruption()

    def step(self, amount=1):
        self.check()
        self.steps += amount
        if self.steps > self.limits["maxSteps"]:
            raise _Fault("runtime-limit-exceeded", "execution")

    def text(self, value):
        self.check()
        if _utf8(value, self.check_interruption) > self.limits["maxStringBytes"]:
            raise _Fault("runtime-limit-exceeded", "execution")
        return value

    def collection(self, length):
        self.check()
        if length > self.limits["maxCollectionLength"]:
            raise _Fault("runtime-limit-exceeded", "execution")


def _inspect_value(value, meter, depth=1):
    meter.step()
    if depth > meter.limits["maxDepth"]:
        raise _Fault("runtime-limit-exceeded", "execution")
    record = _plain(value)
    tag = record.get("tag")
    if tag == "null":
        _exact(record, ["tag"])
        return {"tag": "null"}
    if tag == "boolean":
        _exact(record, ["tag", "value"])
        if type(record["value"]) is not bool:
            _bad()
        return {"tag": "boolean", "value": record["value"]}
    if tag == "text":
        _exact(record, ["tag", "value"])
        if type(record["value"]) is not str:
            _bad()
        return {"tag": "text", "value": meter.text(record["value"])}
    if tag in {"integer", "decimal"}:
        _exact(record, ["tag", "value"])
        text = record["value"]
        pattern = _INTEGER if tag == "integer" else _DECIMAL
        if type(text) is not str or re.fullmatch(pattern, text) is None:
            _bad()
        return {"tag": tag, "value": meter.text(text)}
    if tag == "list":
        _exact(record, ["tag", "value"])
        if type(record["value"]) is not list:
            _bad()
        meter.collection(len(record["value"]))
        return {"tag": "list", "value": [_inspect_value(item, meter, depth + 1) for item in record["value"]]}
    if tag == "record":
        _exact(record, ["tag", "value"])
        if type(record["value"]) is not list:
            _bad()
        meter.collection(len(record["value"]))
        entries = []
        previous = None
        for entry in record["value"]:
            item = _plain(entry)
            _exact(item, ["key", "value"])
            key = _required_text(item["key"], meter)
            if previous is not None and previous >= key:
                _bad()
            previous = key
            entries.append({"key": key, "value": _inspect_value(item["value"], meter, depth + 1)})
        return {"tag": "record", "value": entries}
    _bad()


def _inspect_slot(value, meter):
    record = _plain(value)
    if record.get("presence") == "absent":
        _exact(record, ["presence"])
        return {"presence": "absent"}
    if record.get("presence") == "value":
        _exact(record, ["presence", "value"])
        return {"presence": "value", "value": _inspect_value(record["value"], meter)}
    _bad()


def _inspect_request(value, check):
    record = _plain(value)
    _exact(record, ["format", "requestId", "entry", "arguments", "control", "limits"])
    if record["format"] != format:
        _bad()
    limits = _plain(record["limits"])
    _exact(limits, _LIMIT_KEYS)
    limits = {key: _positive(limits[key]) for key in [
        "maxBytes", "maxCollectionLength", "maxDepth", "maxDiagnostics",
        "maxEvents", "maxSteps", "maxStringBytes",
    ]}
    meter = _Meter(limits, check)
    request_id = _required_text(record["requestId"], meter)
    entry = _plain(record["entry"])
    _exact(entry, ["moduleId", "handlerName"])
    module_id = _required_text(entry["moduleId"], meter)
    handler_name = _required_text(entry["handlerName"], meter)
    if not module_id.endswith(".kern") or re.fullmatch(_IDENTIFIER, handler_name) is None:
        _bad()
    control = _plain(record["control"])
    _exact(control, ["preCancelled", "timeoutMs"])
    timeout = control["timeoutMs"]
    if type(control["preCancelled"]) is not bool:
        _bad()
    if timeout is not None and (type(timeout) is not int or timeout < 1 or timeout > 2147483647):
        _bad()
    arguments = _plain(record["arguments"])
    names = sorted(arguments)
    meter.collection(len(names))
    inspected = {}
    for name in names:
        if re.fullmatch(_IDENTIFIER, name) is None:
            _bad()
        meter.text(name)
        inspected[name] = _inspect_value(arguments[name], meter)
    request = {
        "format": format, "requestId": request_id,
        "entry": {"moduleId": module_id, "handlerName": handler_name},
        "arguments": inspected,
        "control": {"preCancelled": control["preCancelled"], "timeoutMs": timeout},
        "limits": limits,
    }
    if _utf8(_data_text(request)) > limits["maxBytes"]:
        raise _Fault("runtime-limit-exceeded", "execution")
    return request, meter


def _request_id_from(value):
    return value.get("requestId") if type(value) is dict and type(value.get("requestId")) is str else None


def _inspect_options(value):
    if value is None:
        return {}
    record = _plain(value)
    if any(key not in {"invoke", "signal"} for key in record):
        _bad()
    if "invoke" in record and not callable(record["invoke"]):
        _bad()
    if "signal" in record and not isinstance(record["signal"], asyncio.Event):
        _bad()
    return record
`;
