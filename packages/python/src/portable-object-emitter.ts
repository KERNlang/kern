export function pythonRouteRecordExpr(expr: string): string {
  return `(lambda __k_src: __k_src if isinstance(__k_src, dict) else getattr(__k_src, "_d") if hasattr(__k_src, "_d") and isinstance(getattr(__k_src, "_d"), dict) else __k_src.model_dump() if hasattr(__k_src, "model_dump") and callable(__k_src.model_dump) else __k_src.dict() if hasattr(__k_src, "dict") and callable(__k_src.dict) else vars(__k_src) if hasattr(__k_src, "__dict__") else {})(${expr})`;
}

export function pythonRouteRecordPickExpr(sourceExpr: string, keysExpr: string): string {
  return `(lambda __k_dict, __k_keys: {key: (__k_dict[key] if key in __k_dict else None) for key in __k_keys})(${pythonRouteRecordExpr(sourceExpr)}, ${keysExpr})`;
}
