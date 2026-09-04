import asyncio
import importlib.util
import json
import sys
import threading
from pathlib import Path

entry_path, input_path, output_path = sys.argv[1:]

def load_module(name):
    spec = importlib.util.spec_from_file_location(name, entry_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


at_import = sys.get_int_max_str_digits()
module = load_module("kern_digit_window_entry_a")
peer_module = load_module("kern_digit_window_entry_b")
after_import = sys.get_int_max_str_digits()

request = json.loads(Path(input_path).read_text(encoding="utf-8"))
envelope = asyncio.run(module.execute(request, None))
after_execution = sys.get_int_max_str_digits()
first_entered = threading.Event()
release_first = threading.Event()
second_entered = threading.Event()
errors = []
first_inside = []
second_inside = []


def first_convert(argument):
    first_inside.append(sys.get_int_max_str_digits())
    first_entered.set()
    release_first.wait(5)
    return argument


def second_convert(argument):
    second_inside.append(sys.get_int_max_str_digits())
    second_entered.set()
    return argument


def convert_with(module, convert):
    try:
        module._lifted_digits(convert, "0")
    except BaseException as error:
        errors.append(f"{type(error).__name__}: {error}")


first = threading.Thread(target=convert_with, args=(module, first_convert))
second = threading.Thread(target=convert_with, args=(peer_module, second_convert))
first.start()
first_entered.wait(5)
second.start()
second_entered_before_release = second_entered.wait(0.2)
release_first.set()
first.join(5)
second.join(5)
nested_outer_inside = []
nested_inner_inside = []


def nested_inner(argument):
    nested_inner_inside.append(sys.get_int_max_str_digits())
    return argument


def nested_outer(argument):
    nested_outer_inside.append(sys.get_int_max_str_digits())
    return peer_module._lifted_digits(nested_inner, argument)


nested_result = module._lifted_digits(nested_outer, "0")
after_windows = sys.get_int_max_str_digits()

Path(output_path).write_text(
    json.dumps(
        {
            "afterExecution": after_execution,
            "afterImport": after_import,
            "atImport": at_import,
            "envelope": envelope,
            "window": {
                "afterWindows": after_windows,
                "errors": errors,
                "firstInside": first_inside,
                "nestedInnerInside": nested_inner_inside,
                "nestedOuterInside": nested_outer_inside,
                "nestedResult": nested_result,
                "secondEnteredBeforeRelease": second_entered_before_release,
                "secondInside": second_inside,
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ),
    encoding="utf-8",
)
