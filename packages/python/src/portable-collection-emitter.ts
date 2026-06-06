export function pythonRouteCompactPredicate(item: string): string {
  return `${item} is not None and ${item} is not False and ${item} != "" and not (isinstance(${item}, (int, float)) and not isinstance(${item}, bool) and (${item} == 0 or (isinstance(${item}, float) and ${item} != ${item})))`;
}

export function emitPythonRouteSortKeyHelper(lines: string[], indent: string, helperName: string): void {
  lines.push(`${indent}def ${helperName}(__kern_value):`);
  lines.push(`${indent}    if __kern_value is None:`);
  lines.push(`${indent}        return "null"`);
  lines.push(`${indent}    if isinstance(__kern_value, bool):`);
  lines.push(`${indent}        return "true" if __kern_value else "false"`);
  lines.push(`${indent}    if isinstance(__kern_value, float):`);
  lines.push(`${indent}        if __kern_value != __kern_value:`);
  lines.push(`${indent}            return "NaN"`);
  lines.push(`${indent}        if __kern_value == float("inf"):`);
  lines.push(`${indent}            return "Infinity"`);
  lines.push(`${indent}        if __kern_value == float("-inf"):`);
  lines.push(`${indent}            return "-Infinity"`);
  lines.push(`${indent}        if __kern_value.is_integer():`);
  lines.push(`${indent}            return str(int(__kern_value))`);
  lines.push(`${indent}        return str(__kern_value)`);
  lines.push(`${indent}    if isinstance(__kern_value, int):`);
  lines.push(`${indent}        return str(__kern_value)`);
  lines.push(`${indent}    if isinstance(__kern_value, str):`);
  lines.push(`${indent}        return __kern_value`);
  lines.push(`${indent}    if isinstance(__kern_value, list):`);
  lines.push(
    `${indent}        return ",".join("" if __kern_item is None else ${helperName}(__kern_item) for __kern_item in __kern_value)`,
  );
  lines.push(`${indent}    return "[object Object]"`);
}

export function emitPythonRouteStringCoerceHelper(lines: string[], indent: string, helperName: string): void {
  emitPythonRouteSortKeyHelper(lines, indent, helperName);
}

export function emitPythonRouteTrimHelper(
  lines: string[],
  indent: string,
  helperName: string,
  stringCoerceName: string,
): void {
  lines.push(`${indent}def ${helperName}(__kern_value):`);
  lines.push(
    `${indent}    return ${stringCoerceName}(__kern_value).strip("\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff")`,
  );
}

export function emitPythonRouteJoinPartHelper(lines: string[], indent: string, helperName: string): void {
  lines.push(`${indent}def ${helperName}(__kern_value):`);
  lines.push(`${indent}    if __kern_value is None:`);
  lines.push(`${indent}        return ""`);
  lines.push(`${indent}    if isinstance(__kern_value, bool):`);
  lines.push(`${indent}        return "true" if __kern_value else "false"`);
  lines.push(`${indent}    if isinstance(__kern_value, float):`);
  lines.push(`${indent}        if __kern_value != __kern_value:`);
  lines.push(`${indent}            return "NaN"`);
  lines.push(`${indent}        if __kern_value == float("inf"):`);
  lines.push(`${indent}            return "Infinity"`);
  lines.push(`${indent}        if __kern_value == float("-inf"):`);
  lines.push(`${indent}            return "-Infinity"`);
  lines.push(`${indent}        if __kern_value.is_integer():`);
  lines.push(`${indent}            return str(int(__kern_value))`);
  lines.push(`${indent}        return str(__kern_value)`);
  lines.push(`${indent}    if isinstance(__kern_value, int):`);
  lines.push(`${indent}        return str(__kern_value)`);
  lines.push(`${indent}    if isinstance(__kern_value, str):`);
  lines.push(`${indent}        return __kern_value`);
  lines.push(`${indent}    raise TypeError("portable route \`join\` supports only scalar/null list elements")`);
}

export function emitPythonRouteConcatHelper(lines: string[], indent: string, helperName: string): void {
  lines.push(`${indent}def ${helperName}(__kern_left, __kern_right):`);
  lines.push(`${indent}    if not isinstance(__kern_left, list) or not isinstance(__kern_right, list):`);
  lines.push(
    `${indent}        raise TypeError("portable route \`concat\` supports exactly one list-valued with= operand")`,
  );
  lines.push(`${indent}    return list(__kern_left) + list(__kern_right)`);
}

export function emitPythonRouteScalarLookupHelpers(
  lines: string[],
  indent: string,
  assertScalarName: string,
  sameValueZeroName: string,
  strictEqualName: string,
): void {
  lines.push(`${indent}def ${assertScalarName}(__kern_value, __kern_node):`);
  lines.push(`${indent}    if __kern_value is None:`);
  lines.push(`${indent}        return __kern_value`);
  lines.push(`${indent}    if isinstance(__kern_value, bool):`);
  lines.push(`${indent}        return __kern_value`);
  lines.push(`${indent}    if isinstance(__kern_value, (str, int, float)):`);
  lines.push(`${indent}        return __kern_value`);
  lines.push(
    `${indent}    raise TypeError("portable route \`" + __kern_node + "\` supports only scalar/null search values")`,
  );
  lines.push(`${indent}def ${sameValueZeroName}(__kern_left, __kern_right):`);
  lines.push(`${indent}    if isinstance(__kern_left, bool) or isinstance(__kern_right, bool):`);
  lines.push(
    `${indent}        return isinstance(__kern_left, bool) and isinstance(__kern_right, bool) and __kern_left == __kern_right`,
  );
  lines.push(`${indent}    if isinstance(__kern_left, (int, float)) and isinstance(__kern_right, (int, float)):`);
  lines.push(
    `${indent}        if isinstance(__kern_left, float) and __kern_left != __kern_left and isinstance(__kern_right, float) and __kern_right != __kern_right:`,
  );
  lines.push(`${indent}            return True`);
  lines.push(`${indent}        return __kern_left == __kern_right`);
  lines.push(`${indent}    if __kern_left is None or __kern_right is None:`);
  lines.push(`${indent}        return __kern_left is None and __kern_right is None`);
  lines.push(`${indent}    if isinstance(__kern_left, str) or isinstance(__kern_right, str):`);
  lines.push(
    `${indent}        return isinstance(__kern_left, str) and isinstance(__kern_right, str) and __kern_left == __kern_right`,
  );
  lines.push(`${indent}    return False`);
  lines.push(`${indent}def ${strictEqualName}(__kern_left, __kern_right):`);
  lines.push(`${indent}    if isinstance(__kern_left, bool) or isinstance(__kern_right, bool):`);
  lines.push(
    `${indent}        return isinstance(__kern_left, bool) and isinstance(__kern_right, bool) and __kern_left == __kern_right`,
  );
  lines.push(`${indent}    if isinstance(__kern_left, (int, float)) and isinstance(__kern_right, (int, float)):`);
  lines.push(`${indent}        if isinstance(__kern_left, float) and __kern_left != __kern_left:`);
  lines.push(`${indent}            return False`);
  lines.push(`${indent}        if isinstance(__kern_right, float) and __kern_right != __kern_right:`);
  lines.push(`${indent}            return False`);
  lines.push(`${indent}        return __kern_left == __kern_right`);
  lines.push(`${indent}    if __kern_left is None or __kern_right is None:`);
  lines.push(`${indent}        return __kern_left is None and __kern_right is None`);
  lines.push(`${indent}    if isinstance(__kern_left, str) or isinstance(__kern_right, str):`);
  lines.push(
    `${indent}        return isinstance(__kern_left, str) and isinstance(__kern_right, str) and __kern_left == __kern_right`,
  );
  lines.push(`${indent}    return False`);
}

export function emitPythonRoutePluckHelper(
  lines: string[],
  indent: string,
  helperName: string,
  pathExpr: string,
): void {
  lines.push(`${indent}def ${helperName}(__kern_item):`);
  lines.push(`${indent}    __kern_value = __kern_item`);
  lines.push(`${indent}    for __kern_key in ${pathExpr}:`);
  lines.push(`${indent}        if __kern_value is None:`);
  lines.push(`${indent}            return None`);
  lines.push(`${indent}        if isinstance(__kern_value, dict):`);
  lines.push(`${indent}            __kern_value = __kern_value.get(__kern_key)`);
  lines.push(`${indent}        elif isinstance(__kern_value, list) and str(__kern_key).isdigit():`);
  lines.push(`${indent}            __kern_index = int(__kern_key)`);
  lines.push(
    `${indent}            __kern_value = __kern_value[__kern_index] if 0 <= __kern_index < len(__kern_value) else None`,
  );
  lines.push(`${indent}        elif hasattr(__kern_value, "_d") and isinstance(getattr(__kern_value, "_d"), dict):`);
  lines.push(`${indent}            __kern_value = getattr(__kern_value, "_d").get(__kern_key)`);
  lines.push(`${indent}        else:`);
  lines.push(
    `${indent}            __kern_record = __kern_value.model_dump() if hasattr(__kern_value, "model_dump") and callable(__kern_value.model_dump) else __kern_value.dict() if hasattr(__kern_value, "dict") and callable(__kern_value.dict) else vars(__kern_value) if hasattr(__kern_value, "__dict__") else None`,
  );
  lines.push(`${indent}            if isinstance(__kern_record, dict):`);
  lines.push(`${indent}                __kern_value = __kern_record.get(__kern_key)`);
  lines.push(`${indent}            else:`);
  lines.push(`${indent}                return None`);
  lines.push(`${indent}    return __kern_value`);
}
