# External State (`external=true`)

Use `external=true` on a `state` node when the value is a **stable mutable object** — a registry, a config singleton, an event bus, anything whose JavaScript identity never changes but whose internal state does. The codegen emits a hidden version counter and a `bump${Name}()` callback. Any memo that depends on the state name automatically gets the version counter injected into its dep array.

This replaces the manual two-state pattern Agon and similar projects invented:

```kern
# Old: two states, manual bump, manual dep listing
state name=registry type=EngineRegistry initial="(() => { const r = new EngineRegistry(); r.load(); return r; })()"
state name=registryVersion type=number initial="0"
memo name=availableEngines deps="registry, registryVersion"
  handler <<<
    return registry.availableIds();
  >>>
# ...and somewhere in a handler:
# setRegistryVersion((v: number) => v + 1)
```

with:

```kern
# New: one state, automatic version, single bump call
state name=registry type=EngineRegistry initial="(() => { const r = new EngineRegistry(); r.load(); return r; })()" external=true
memo name=availableEngines deps="registry"
  handler <<<
    return registry.availableIds();
  >>>
# ...and somewhere in a handler:
# bumpRegistry()
```

Net savings: one fewer `state` node, no manual dep listing, the `setRegistryVersion((v: number) => v + 1)` arithmetic collapses to `bumpRegistry()`.

## What gets emitted

For `state name=registry type=Registry initial="new Registry()" external=true`, the codegen produces:

```ts
const [registry, setRegistry] = useState<Registry>(() => new Registry());
const [_registryVersion, _setRegistryVersionRaw] = useState<number>(0);
const bumpRegistry = useMemo(() => {
  return () => setTimeout(() => _setRegistryVersionRaw((v: number) => v + 1), 0);
}, []);
void _registryVersion;
```

Five things to notice:

1. **The held value gets a bare `useState`**, not the `__inkSafe`-wrapped form. External state is meant to be mutated in place — you never call `setRegistry(...)` in normal use, so the wrapper would never fire. The bare setter is left exposed for the rare full-replacement case (e.g., reload-from-disk).
2. **A hidden version counter `_${name}Version`** is emitted as a separate `useState`. The leading underscore signals "internal — don't reference directly."
3. **`bump${Name}()` is a memoized callback** that schedules the version bump in a `setTimeout(..., 0)`. The `setTimeout` is not for batching — it bridges the same microtask→macrotask gap that `__inkSafe` solves for normal setters, so a `bump` from inside an Ink event handler reliably triggers a paint.
4. **`void _${name}Version`** is a one-line touch so the binding is "used" — the actual reference happens through memo dep arrays, but TypeScript would otherwise flag the local as unused.
5. **The full-replacement setter (`setRegistry`) stays exposed.** If you really need to swap the held object, call it like any other state setter. The bump callback is independent — it bumps the version, not the held object.

## Auto-injection of memo dependencies

Any `memo` node whose `deps=` list mentions an external state name automatically gets `_${name}Version` appended:

```kern
memo name=available deps="registry"           # written
# becomes [registry, _registryVersion]         # emitted
```

The injection is **idempotent** — if you already wrote `deps="registry, _registryVersion"` manually, the output is identical (the version isn't duplicated). It is also **scoped** — a memo that only depends on a regular state (`deps="count"`) gets nothing injected, even if other external states exist on the same screen.

You generally do not need to reference `_${name}Version` by hand. Write `deps="registry"`, mutate the registry in a handler, call `bumpRegistry()`, and the memo re-runs.

## Calling `bump${Name}()` from a handler

```kern
on event=key key=enter
  handler <<<
    registry.add({ id: nextId });
    bumpRegistry();
  >>>
```

The bump can sit anywhere in the handler body. It is itself a `setTimeout(..., 0)`, so it shares the same Ink-safety properties as `__inkSafe`-wrapped setters. You can also pair it with `batch=true` — see the next section.

## Interaction with `batch=true`

`bumpRegistry()` is a function call, not a recognized state-setter pattern, so the `batch=true` rewrite leaves it alone. Inside a batched handler, `bumpRegistry()` runs synchronously inside the batch's shared `setTimeout`, the same as any other expression. The version state update happens via the bump's own `setTimeout`, which lands in a later task — that is acceptable because the bump's whole purpose is to trigger a re-render of the dependent memos, and the dependent memos will re-run on the next render whether the bump's task lands in the same paint cycle or the next one.

If you want strict "bump and dependent re-renders all in one paint cycle," call the inner raw setter directly inside the batch instead:

```kern
on event=key key=enter batch=true
  handler <<<
    registry.add({ id: nextId });
    _setRegistryVersionRaw((v: number) => v + 1);
    setOtherCount(otherCount + 1);
  >>>
```

The `_setRegistryVersionRaw` underscore-name is documented as the escape hatch for this case.

## When to use `external=true`

- **Long-lived registries, command tables, plugin lists, event buses** — anything created once at component mount and mutated in place.
- **Configuration singletons** that you load once from disk and refresh occasionally.
- **Caches** whose contents change but whose identity does not.

## When not to use `external=true`

- **Plain values** (numbers, strings, booleans). Use a normal `state` node.
- **Immutable data structures** that you replace via `setX(newValue)`. The version counter would just be dead weight — a normal `state` node already invalidates dependent memos on identity change.
- **Anything you need to reset across mounts.** The version counter persists for the component's lifetime; if you want a fresh registry on each mount, declare a normal `state` and reassign with the setter.

## Limitations

- **Auto-injection matches against `deps=` tokens, not memo body content.** The injection logic splits `deps="..."` on commas, trims, and looks for an exact token match against the external state name. A memo whose **body** uses `registry.foo` but whose `deps="registry"` is matched and gets `_registryVersion` injected. A memo whose `deps="registry.items"` is **not** matched — property access has no place in a dep array, and the token is a literal string compare. A memo that aliases through a local (`const r = registry; ... r.foo`) is also not matched, because the dep list says `r`, not `registry`. Rule of thumb: list the bare external state name in `deps=`, never a property path.
- **Per-screen scope.** External state is a per-component primitive. Two different screens cannot share one external state via `external=true` — that would be a context provider, which is a different shape.
- **No automatic bump on object-method call.** The user must call `bumpRegistry()` explicitly after mutating. The codegen has no way to know which method calls mutate vs. read.

## Hard rejections

The codegen throws at compile time if `external=true` is combined with any of:

- `throttle=N` — external state holds a stable reference, throttling has no meaning here. Drop one.
- `debounce=N` — same reason.
- `safe=false` — external state already emits a bare `useState` (the safe wrapper does not apply), so `safe=false` is redundant. Drop it.

These were silent ignores in the first cut and are now enforced because each combination signals a misunderstanding of what `external=true` means.

## Interaction with `batch=true` (corrected)

The `batch=true` rewrite (`setX(...)` → `_setXRaw(...)`) **never rewrites external state setters**. The held value's `useState` is bare — there is no `_setRegistryRaw` to rewrite to. This means a full-replacement call inside a batched handler:

```kern
on event=key key=return batch=true
  handler <<<
    setRegistry(new Registry());
    setCount(count + 1);
  >>>
```

emits `setRegistry(new Registry())` unchanged inside the batched setTimeout, alongside `_setCountRaw(count + 1)`. The full replacement is a synchronous setState — React 18 batches it inside the same task as the raw setter calls, so you still get one render. If you want strict version-bump semantics in this case, call `bumpRegistry()` after the replacement (or both — bump is idempotent against re-bump).

## Interaction with `derive` nodes

Both `memo` and `derive` nodes auto-receive `_${name}Version` when their deps reference an external state. For `derive` with **explicit** `deps="..."`, the same token-match injection runs. For `derive` with **auto-detected** deps (no `deps=` prop, the codegen scans the expression for state/ref names), if the auto-detected list contains an external state name, `_${name}Version` is appended automatically. So:

```kern
derive name=count expr={{ registry.list().length }}
```

compiles to:

```ts
const count = useMemo(() => registry.list().length, [registry, _registryVersion]);
```

with no explicit deps needed.
