import asyncio
import importlib.util
import json
import sys
from pathlib import Path


def load_entry(path):
    spec = importlib.util.spec_from_file_location("kern_compiled_entry", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("entry.py cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def main(module, payload):
    abort_at = payload["abortAtInvocation"]
    external = None if abort_at is None else asyncio.Event()
    if abort_at == 0:
        external.set()
    calls = []
    seen = {"count": 0}

    async def invoke(call):
        seen["count"] += 1
        calls.append({"namespace": call["namespace"], "operation": call["operation"]})
        if abort_at is not None and seen["count"] == abort_at:
            external.set()
        return {"presence": "value", "value": {"tag": "text", "value": "reply-value"}}

    options = {} if payload.get("omitProvider", False) else {"invoke": invoke}
    if external is not None:
        options["signal"] = external
    envelope = await asyncio.wait_for(module.execute(payload["request"], options), timeout=5)
    return {"calls": calls, "envelope": envelope}


entry_path, input_path, output_path = sys.argv[1:]
entry_module = load_entry(entry_path)
input_payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
output_payload = asyncio.run(main(entry_module, input_payload))
Path(output_path).write_text(
    json.dumps(output_payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
    encoding="utf-8",
)
