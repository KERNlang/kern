export const KERN_PAIR_HELPERS_PY = [
  'def _kern_pairs(__k_v):',
  '    return __k_v.items() if hasattr(__k_v, "items") else iter(__k_v)',
  '',
  'async def _kern_async_pairs(__k_v):',
  '    if hasattr(__k_v, "__aiter__"):',
  '        async for __k_item in __k_v:',
  '            yield __k_item',
  '    else:',
  '        for __k_item in _kern_pairs(__k_v):',
  '            yield __k_item',
].join('\n');

export const KERN_FMT_HELPER_PY = [
  'def _kern_fmt(__k_v):',
  '    if isinstance(__k_v, bool):',
  "        return 'true' if __k_v else 'false'",
  '    if __k_v is None:',
  "        return 'null'",
  '    return str(__k_v)',
].join('\n');

export const KERN_I32_HELPER_PY = [
  'import math',
  'def _i32(x):',
  '    if x is None: return 0',
  '    try:',
  '        if not math.isfinite(x): return 0',
  '        val = int(math.trunc(x))',
  '    except Exception:',
  '        try:',
  '            val = float(x)',
  '            if not math.isfinite(val): return 0',
  '            val = int(math.trunc(val))',
  '        except Exception:',
  '            return 0',
  '    return ((val & 0xFFFFFFFF) ^ 0x80000000) - 0x80000000',
].join('\n');

export const KERN_TMOD_HELPER_PY = [
  'import math',
  'def _tmod(a, b):',
  '    if a is None: a = 0',
  '    if b is None: b = 0',
  '    try:',
  '        fa = float(a)',
  '        fb = float(b)',
  '    except Exception:',
  "        return float('nan')",
  "    if math.isnan(fa) or math.isnan(fb): return float('nan')",
  "    if math.isinf(fa): return float('nan')",
  "    if fb == 0: return float('nan')",
  '    if math.isinf(fb): return fa',
  '    return fa - math.trunc(fa / fb) * fb',
].join('\n');

export const KERN_JS_HELPER_PY = [
  'def js_truthy(x):',
  '    if x is None or x is False: return False',
  '    if isinstance(x, (int, float)) and x == 0: return False',
  '    if isinstance(x, str) and x == "": return False',
  '    return True',
  'def js_equals(a, b):',
  '    return a == b',
].join('\n');
