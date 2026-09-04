import asyncio
import importlib.util
import json
import sys
import threading
from pathlib import Path

entry_path, input_path, output_path = sys.argv[1:]


class InstrumentedRLock:
    def __init__(self):
        self._lock = threading.RLock()
        self.acquisitions = 0
        self.second_attempted = threading.Event()

    def __enter__(self):
        if threading.current_thread().name == "digit-window-b":
            self.second_attempted.set()
        self._lock.acquire()
        self.acquisitions += 1
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._lock.release()


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, entry_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


instrumented_lock = InstrumentedRLock()
sys.__dict__["_kern_digit_window_lock"] = instrumented_lock
at_import = sys.get_int_max_str_digits()
module = load_module("kern_digit_window_entry_a")
peer_module = load_module("kern_digit_window_entry_b")
after_import = sys.get_int_max_str_digits()

request = json.loads(Path(input_path).read_text(encoding="utf-8"))
envelope = asyncio.run(module.execute(request, None))
after_execution = sys.get_int_max_str_digits()
short_acquisitions_before = instrumented_lock.acquisitions
short_values = [module._lifted_digits(int, "42"), module._lifted_digits(str, 42)]
short_lock_acquisitions = instrumented_lock.acquisitions - short_acquisitions_before
at_cap_argument = "9" * at_import
at_cap_acquisitions_before = instrumented_lock.acquisitions
at_cap_value = module._lifted_digits(int, at_cap_argument)
at_cap_text = module._lifted_digits(str, at_cap_value)
at_cap_lock_acquisitions = instrumented_lock.acquisitions - at_cap_acquisitions_before
large_argument = "9" * (at_import + 1)
over_cap_acquisitions_before = instrumented_lock.acquisitions
over_cap_value = module._lifted_digits(int, large_argument)
over_cap_text = module._lifted_digits(str, over_cap_value)
over_cap_lock_acquisitions = instrumented_lock.acquisitions - over_cap_acquisitions_before
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


def convert_with(target_module, convert):
    try:
        target_module._lifted_digits(convert, large_argument)
    except BaseException as error:
        errors.append(f"{type(error).__name__}: {error}")


first = threading.Thread(target=convert_with, args=(module, first_convert), name="digit-window-a")
second = threading.Thread(target=convert_with, args=(peer_module, second_convert), name="digit-window-b")
first.start()
first_entered_before_second = first_entered.wait(5)
second.start()
second_acquisition_attempted = instrumented_lock.second_attempted.wait(5)
second_entered_before_release = second_entered.is_set()
release_first.set()
first.join(5)
second.join(5)
nested_outer_inside = []
nested_inner_inside = []


def nested_inner(argument):
    nested_inner_inside.append(sys.get_int_max_str_digits())
    return "0"


def nested_outer(argument):
    nested_outer_inside.append(sys.get_int_max_str_digits())
    return peer_module._lifted_digits(nested_inner, argument)


nested_result = module._lifted_digits(nested_outer, large_argument)
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
                "atCapLockAcquisitions": at_cap_lock_acquisitions,
                "atCapRoundTrip": at_cap_text == at_cap_argument,
                "errors": errors,
                "firstEnteredBeforeSecond": first_entered_before_second,
                "firstInside": first_inside,
                "nestedInnerInside": nested_inner_inside,
                "nestedOuterInside": nested_outer_inside,
                "nestedResult": nested_result,
                "overCapLockAcquisitions": over_cap_lock_acquisitions,
                "overCapRoundTrip": over_cap_text == large_argument,
                "secondAcquisitionAttempted": second_acquisition_attempted,
                "secondEnteredBeforeRelease": second_entered_before_release,
                "secondInside": second_inside,
                "shortLockAcquisitions": short_lock_acquisitions,
                "shortValues": short_values,
                "stableLockBound": module._digit_window_lock is instrumented_lock
                and peer_module._digit_window_lock is instrumented_lock,
                "threadsCompleted": not first.is_alive() and not second.is_alive(),
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ),
    encoding="utf-8",
)
