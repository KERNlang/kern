import math
def _i32(x):
    if x is None: return 0
    try:
        if not math.isfinite(x): return 0
        val = int(math.trunc(x))
    except Exception:
        try:
            val = float(x)
            if not math.isfinite(val): return 0
            val = int(math.trunc(val))
        except Exception:
            return 0
    return ((val & 0xFFFFFFFF) ^ 0x80000000) - 0x80000000
