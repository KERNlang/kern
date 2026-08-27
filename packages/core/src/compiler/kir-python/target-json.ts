export const TARGET_JSON_SOURCE = String.raw`

_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?")

def _json_rejected():
    raise _Fault("unsupported-runtime-input", "execution")


class _JsonReader:
    def __init__(self, source, meter):
        self.source = source
        self.meter = meter
        self.index = 0

    def read(self):
        self.space()
        value = self.read_value(1)
        self.space()
        if self.index != len(self.source):
            _json_rejected()
        return value

    def space(self):
        while self.index < len(self.source) and self.source[self.index] in "\t\n\r ":
            if self.index & 1023 == 0:
                self.meter.check()
            self.index += 1

    def read_value(self, depth):
        self.meter.step()
        if depth > self.meter.limits["maxDepth"]:
            raise _Fault("runtime-limit-exceeded", "execution")
        character = self.source[self.index] if self.index < len(self.source) else None
        if character == '"':
            return {"tag": "text", "value": self.read_string()}
        if character == "[":
            return self.read_list(depth)
        if character == "{":
            return self.read_record(depth)
        for token, value in [("null", {"tag": "null"}), ("true", {"tag": "boolean", "value": True}), ("false", {"tag": "boolean", "value": False})]:
            if self.source.startswith(token, self.index):
                self.index += len(token)
                return value
        return self.read_number()

    def read_string(self):
        self.index += 1
        output = []
        simple = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
        while self.index < len(self.source):
            if self.index & 1023 == 0:
                self.meter.check()
            character = self.source[self.index]
            self.index += 1
            if character == '"':
                return self.meter.text("".join(output))
            if ord(character) < 0x20:
                _json_rejected()
            if character != "\\":
                output.append(character)
                continue
            if self.index >= len(self.source):
                _json_rejected()
            escape = self.source[self.index]
            self.index += 1
            if escape in simple:
                output.append(simple[escape])
                continue
            if escape != "u":
                _json_rejected()
            first = self.unicode_unit()
            if 0xD800 <= first <= 0xDBFF:
                if self.source[self.index:self.index + 2] != "\\u":
                    _json_rejected()
                self.index += 2
                second = self.unicode_unit()
                if not 0xDC00 <= second <= 0xDFFF:
                    _json_rejected()
                output.append(chr(0x10000 + ((first - 0xD800) << 10) + second - 0xDC00))
            else:
                if 0xDC00 <= first <= 0xDFFF:
                    _json_rejected()
                output.append(chr(first))
        _json_rejected()

    def unicode_unit(self):
        digits = self.source[self.index:self.index + 4]
        if len(digits) != 4 or any(character not in "0123456789abcdefABCDEF" for character in digits):
            _json_rejected()
        self.index += 4
        return int(digits, 16)

    def read_list(self, depth):
        self.index += 1
        self.space()
        items = []
        if self.index < len(self.source) and self.source[self.index] == "]":
            self.index += 1
            return {"tag": "list", "value": items}
        while True:
            items.append(self.read_value(depth + 1))
            self.meter.collection(len(items))
            self.space()
            delimiter = self.source[self.index] if self.index < len(self.source) else None
            self.index += 1
            if delimiter == "]":
                return {"tag": "list", "value": items}
            if delimiter != ",":
                _json_rejected()
            self.space()

    def read_record(self, depth):
        self.index += 1
        self.space()
        fields = {}
        if self.index < len(self.source) and self.source[self.index] == "}":
            self.index += 1
            return {"tag": "record", "value": []}
        while True:
            if self.index >= len(self.source) or self.source[self.index] != '"':
                _json_rejected()
            key = self.read_string()
            if key in fields:
                _json_rejected()
            self.space()
            if self.index >= len(self.source) or self.source[self.index] != ":":
                _json_rejected()
            self.index += 1
            self.space()
            fields[key] = self.read_value(depth + 1)
            self.meter.collection(len(fields))
            self.space()
            delimiter = self.source[self.index] if self.index < len(self.source) else None
            self.index += 1
            if delimiter == "}":
                return {"tag": "record", "value": [{"key": key, "value": fields[key]} for key in sorted(fields)]}
            if delimiter != ",":
                _json_rejected()
            self.space()

    def read_number(self):
        self.meter.check()
        match = _NUMBER.match(self.source, self.index)
        if match is None:
            _json_rejected()
        token = match.group(0)
        end = match.end()
        following = self.source[end] if end < len(self.source) else None
        if following and (following in "eE." or re.match(r"[0-9A-Za-z_+\-]", following)):
            _json_rejected()
        if token == "-0":
            _json_rejected()
        self.index = end
        self.meter.text(token)
        return {"tag": "decimal" if "." in token else "integer", "value": token}


def _parse_kern_text(source, meter):
    return _JsonReader(source, meter).read()


def _json_parse_value(value, meter):
    if value["tag"] != "text":
        raise _Fault("unsupported-runtime-input", "execution")
    return _parse_kern_text(value["value"], meter)


def _write_value(value, meter, depth):
    meter.step()
    if depth > meter.limits["maxDepth"]:
        raise _Fault("runtime-limit-exceeded", "execution")
    tag = value["tag"]
    if tag == "null":
        return "null"
    if tag == "boolean":
        return "true" if value["value"] else "false"
    if tag == "text":
        return _quote(value["value"])
    if tag in {"integer", "decimal"}:
        return value["value"]
    meter.collection(len(value["value"]))
    if tag == "list":
        return "[" + ",".join(_write_value(item, meter, depth + 1) for item in value["value"]) + "]"
    return "{" + ",".join(_quote(item["key"]) + ":" + _write_value(item["value"], meter, depth + 1) for item in value["value"]) + "}"


def _stringify_kern_value(value, meter):
    return meter.text(_write_value(value, meter, 1))


def _json_stringify_value(value, meter):
    return {"tag": "text", "value": _stringify_kern_value(value, meter)}


def _encode_value(value, check=lambda: None):
    check()
    tag = value["tag"]
    if tag == "null":
        return "null"
    if tag == "boolean":
        return "true" if value["value"] else "false"
    if tag == "text":
        return _quote(value["value"], check)
    if tag in {"integer", "decimal"}:
        return value["value"]
    if tag == "list":
        return "[" + ",".join(_encode_value(item, check) for item in value["value"]) + "]"
    return "{" + ",".join(_quote(item["key"], check) + ":" + _encode_value(item["value"], check) for item in value["value"]) + "}"


def _member(value, optional, property_name):
    if value["tag"] == "null" and optional:
        return {"tag": "null"}
    if value["tag"] != "record":
        raise _Fault("unsupported-runtime-input", "execution")
    for item in value["value"]:
        if item["key"] == property_name:
            return item["value"]
    if optional:
        return {"tag": "null"}
    raise _Fault("unsupported-runtime-input", "execution")
`;
