export function pythonRouteCompactPredicate(item: string): string {
  return `${item} is not None and ${item} is not False and ${item} != "" and not (isinstance(${item}, (int, float)) and not isinstance(${item}, bool) and (${item} == 0 or (isinstance(${item}, float) and ${item} != ${item})))`;
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
