import asyncio
import importlib.util
import json
import sys
from pathlib import Path

entry_path, input_path, output_path = sys.argv[1:]

spec = importlib.util.spec_from_file_location("kern_digit_window_entry", entry_path)
module = importlib.util.module_from_spec(spec)
at_import = sys.get_int_max_str_digits()
spec.loader.exec_module(module)
after_import = sys.get_int_max_str_digits()

request = json.loads(Path(input_path).read_text(encoding="utf-8"))
envelope = asyncio.run(module.execute(request, None))
after_execution = sys.get_int_max_str_digits()

Path(output_path).write_text(
    json.dumps(
        {
            "afterExecution": after_execution,
            "afterImport": after_import,
            "atImport": at_import,
            "envelope": envelope,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ),
    encoding="utf-8",
)
