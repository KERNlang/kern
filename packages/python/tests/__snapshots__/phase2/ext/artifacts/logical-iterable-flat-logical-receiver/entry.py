[__y for __x in (a || b) for __y in (__x if isinstance(__x, list) else [__x])]
