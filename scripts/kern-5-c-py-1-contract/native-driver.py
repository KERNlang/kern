import asyncio
import importlib.util
import json
import sys
import time
from pathlib import Path


def load_entry(path):
    spec = importlib.util.spec_from_file_location("kern_compiled_entry", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("entry.py cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def slot(reply):
    return {"presence": "value", "value": {"tag": "text", "value": reply}}


def capture_call(call, external_signal):
    if not isinstance(call, dict) or set(call) != {"namespace", "operation", "input", "signal"}:
        raise AssertionError("provider call must be an exact mapping")
    signal = call["signal"]
    if not isinstance(signal, asyncio.Event):
        raise AssertionError("provider signal must be asyncio.Event")
    return {
        "namespace": call["namespace"],
        "operation": call["operation"],
        "input": call["input"],
        "signalIsEvent": True,
        "signalIsInternal": signal is not external_signal,
        "signalSet": signal.is_set(),
    }


async def execute_one(module, spec):
    scenario = spec.get("scenario", "reply")
    external = asyncio.Event() if spec.get("externalSignal", False) else None
    started = asyncio.Event()
    metadata = {"calls": [], "providerCancelled": False}

    if scenario == "signal-before":
        external.set()

    async def invoke(call):
        metadata["calls"].append(capture_call(call, external))
        started.set()
        if scenario == "rejection":
            raise RuntimeError("provider rejected")
        if scenario == "provider-cancelled":
            raise asyncio.CancelledError()
        if scenario == "malformed-result":
            return {"presence": "value", "value": {"tag": "not-a-kir-value"}}
        if scenario == "signal-after-result":
            external.set()
            return slot(spec.get("reply", "reply"))
        if scenario in {"pending", "slow-cancel", "outer-task-cancel"}:
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                metadata["providerCancelled"] = True
                if scenario == "slow-cancel":
                    try:
                        await asyncio.sleep(0.5)
                    except asyncio.CancelledError:
                        pass
                raise
        return slot(spec.get("reply", "reply"))

    if scenario == "provider-cancelled-sync":
        def invoke(call):
            metadata["calls"].append(capture_call(call, external))
            started.set()
            raise asyncio.CancelledError()

    options = {}
    if scenario != "missing-provider":
        options["invoke"] = invoke
    if external is not None:
        options["signal"] = external

    async def set_signal_after_start():
        await started.wait()
        await asyncio.sleep(spec.get("cancelDelayMs", 0) / 1000)
        external.set()

    watcher = None
    if scenario in {"pending", "slow-cancel"} and external is not None:
        watcher = asyncio.create_task(set_signal_after_start())
    started_at = time.monotonic()
    execution = asyncio.create_task(module.execute(spec["request"], options or None))
    if scenario == "outer-task-cancel":
        started_wait = asyncio.create_task(started.wait())
        try:
            done, _pending = await asyncio.wait(
                {execution, started_wait}, timeout=2, return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                raise TimeoutError("outer-task-cancel provider start timed out")
            if execution in done:
                result = execution.result()
            else:
                execution.cancel()
                try:
                    await asyncio.wait_for(execution, timeout=2)
                    raise AssertionError("outer execution cancellation was swallowed")
                except asyncio.CancelledError:
                    result = {"outerCancellationPropagated": True}
                    await asyncio.sleep(0)
        finally:
            if not started_wait.done():
                started_wait.cancel()
    else:
        result = await asyncio.wait_for(execution, timeout=2)
    metadata["elapsedMs"] = round((time.monotonic() - started_at) * 1000, 3)
    if watcher is not None:
        await watcher
    return result, metadata


async def execute_concurrent(module, runs):
    started = 0
    all_started = asyncio.Event()
    metadata = []

    async def one(spec):
        nonlocal started
        calls = []

        async def invoke(call):
            nonlocal started
            calls.append(capture_call(call, None))
            started += 1
            if started == len(runs):
                all_started.set()
            await all_started.wait()
            await asyncio.sleep(spec.get("delayMs", 0) / 1000)
            return slot(spec["reply"])

        result = await module.execute(spec["request"], {"invoke": invoke})
        metadata.append({"requestId": spec["request"]["requestId"], "calls": calls})
        return result

    return await asyncio.gather(*(one(spec) for spec in runs)), metadata


async def main(module, payload):
    runs = payload["runs"]
    if payload.get("mode") == "concurrent":
        results, metadata = await execute_concurrent(module, runs)
    else:
        pairs = [await execute_one(module, spec) for spec in runs]
        results = [pair[0] for pair in pairs]
        metadata = [pair[1] for pair in pairs]
    return {
        "format": module.format,
        "manifest": module.manifest,
        "results": results,
        "metadata": metadata,
    }


entry_path, input_path, output_path = sys.argv[1:]
entry_module = load_entry(entry_path)
input_payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
output_payload = asyncio.run(main(entry_module, input_payload))
Path(output_path).write_text(
    json.dumps(output_payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
    encoding="utf-8",
)
