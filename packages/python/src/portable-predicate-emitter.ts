export function emitPythonPredicateHelpers(
  indent: string,
  absentVar: string,
  getPathVar: string,
  equalVar: string,
  evalPredVar: string,
): string[] {
  const lines: string[] = [];
  lines.push(`${indent}class ${absentVar}:`);
  lines.push(`${indent}    pass`);
  lines.push(`${indent}def ${getPathVar}(record, path):`);
  lines.push(`${indent}    if record is None:`);
  lines.push(`${indent}        return ${absentVar}`);
  lines.push(`${indent}    parts = path.split('.')`);
  lines.push(`${indent}    current = record`);
  lines.push(`${indent}    for part in parts:`);
  lines.push(`${indent}        if current is None:`);
  lines.push(`${indent}            return ${absentVar}`);
  lines.push(`${indent}        if hasattr(current, "model_dump") and callable(current.model_dump):`);
  lines.push(`${indent}            current = current.model_dump()`);
  lines.push(`${indent}        elif hasattr(current, "dict") and callable(current.dict):`);
  lines.push(`${indent}            current = current.dict()`);
  lines.push(`${indent}        elif hasattr(current, "_d") and isinstance(current._d, dict):`);
  lines.push(`${indent}            current = current._d`);
  lines.push(`${indent}        if isinstance(current, dict):`);
  lines.push(`${indent}            if part in current:`);
  lines.push(`${indent}                current = current[part]`);
  lines.push(`${indent}            else:`);
  lines.push(`${indent}                return ${absentVar}`);
  lines.push(`${indent}        elif isinstance(current, (list, tuple)):`);
  lines.push(`${indent}            if not (part == "0" or (part.isdecimal() and not part.startswith("0"))):`);
  lines.push(`${indent}                return ${absentVar}`);
  lines.push(`${indent}            index = int(part)`);
  lines.push(`${indent}            if index >= len(current):`);
  lines.push(`${indent}                return ${absentVar}`);
  lines.push(`${indent}            current = current[index]`);
  lines.push(`${indent}        else:`);
  lines.push(`${indent}            return ${absentVar}`);
  lines.push(`${indent}    return current`);

  lines.push(`${indent}def ${equalVar}(actual, expected):`);
  lines.push(`${indent}    if isinstance(actual, bool) or isinstance(expected, bool):`);
  lines.push(`${indent}        return isinstance(actual, bool) and isinstance(expected, bool) and actual == expected`);
  lines.push(`${indent}    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):`);
  lines.push(`${indent}        return actual == expected`);
  lines.push(`${indent}    if isinstance(actual, str) or isinstance(expected, str):`);
  lines.push(`${indent}        return isinstance(actual, str) and isinstance(expected, str) and actual == expected`);
  lines.push(`${indent}    return actual is None and expected is None`);
  lines.push(`${indent}def ${evalPredVar}(predicate, record):`);
  lines.push(`${indent}    if not isinstance(predicate, dict):`);
  lines.push(`${indent}        raise ValueError("invalid KERN filter predicate")`);
  lines.push(`${indent}    if "and" in predicate:`);
  lines.push(
    `${indent}        if len(predicate) != 1 or not isinstance(predicate["and"], list) or len(predicate["and"]) == 0:`,
  );
  lines.push(`${indent}            raise ValueError("invalid KERN filter predicate")`);
  lines.push(`${indent}        return all(${evalPredVar}(p, record) for p in predicate["and"])`);
  lines.push(`${indent}    if "or" in predicate:`);
  lines.push(
    `${indent}        if len(predicate) != 1 or not isinstance(predicate["or"], list) or len(predicate["or"]) == 0:`,
  );
  lines.push(`${indent}            raise ValueError("invalid KERN filter predicate")`);
  lines.push(`${indent}        return any(${evalPredVar}(p, record) for p in predicate["or"])`);
  lines.push(`${indent}    if "not" in predicate:`);
  lines.push(`${indent}        if len(predicate) != 1 or not isinstance(predicate["not"], dict):`);
  lines.push(`${indent}            raise ValueError("invalid KERN filter predicate")`);
  lines.push(`${indent}        return not ${evalPredVar}(predicate["not"], record)`);
  lines.push(
    `${indent}    op = next((candidate for candidate in ("eq", "neq", "gt", "gte", "lt", "lte") if candidate in predicate), None)`,
  );
  lines.push(`${indent}    if op is None or len(predicate) != 1:`);
  lines.push(`${indent}        raise ValueError("invalid KERN filter predicate")`);
  lines.push(`${indent}    pair = predicate[op]`);
  lines.push(`${indent}    if not isinstance(pair, list) or len(pair) != 2 or not isinstance(pair[0], str):`);
  lines.push(`${indent}        raise ValueError("invalid KERN filter predicate")`);
  lines.push(`${indent}    path, expected = pair`);
  lines.push(`${indent}    actual = ${getPathVar}(record, path)`);
  lines.push(`${indent}    if op == "eq":`);
  lines.push(`${indent}        return actual is not ${absentVar} and ${equalVar}(actual, expected)`);
  lines.push(`${indent}    if op == "neq":`);
  lines.push(`${indent}        if actual is ${absentVar}:`);
  lines.push(`${indent}            return expected is not None`);
  lines.push(`${indent}        return not ${equalVar}(actual, expected)`);
  lines.push(`${indent}    if op in ("gt", "gte", "lt", "lte"):`);
  lines.push(`${indent}        if not isinstance(actual, (int, float)) or isinstance(actual, bool):`);
  lines.push(`${indent}            return False`);
  lines.push(`${indent}        if not isinstance(expected, (int, float)) or isinstance(expected, bool):`);
  lines.push(`${indent}            return False`);
  lines.push(`${indent}        if op == "gt":`);
  lines.push(`${indent}            return actual > expected`);
  lines.push(`${indent}        if op == "gte":`);
  lines.push(`${indent}            return actual >= expected`);
  lines.push(`${indent}        if op == "lt":`);
  lines.push(`${indent}            return actual < expected`);
  lines.push(`${indent}        return actual <= expected`);
  lines.push(`${indent}    raise ValueError("invalid KERN filter predicate")`);
  return lines;
}
