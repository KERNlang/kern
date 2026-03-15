# Kern CLI Transpiler — Implementation Plan

## Goal
Add `cli` transpiler target to Kern that generates Commander.js TypeScript from `.kern` files. V1 scope: `cli`, `command`, `arg`, `flag` nodes. REPL and process nodes deferred to V2.

## New IR Node Types

### `cli` — Top-level application
```
cli name=agon version=2.0.0 description="Competitive AI orchestration"
```
Props: `name` (required), `version`, `description`, `bin` (binary name, defaults to name)

### `command` — Subcommand (can nest)
```
command name=forge description="Run competitive forge"
```
Props: `name` (required), `description`, `alias`

### `arg` — Positional argument
```
arg name=task type=string required=true description="Task to forge"
```
Props: `name` (required), `type` (string|number|boolean, default string), `required` (default false), `description`, `default`

### `flag` — Option flag
```
flag name=timeout alias=t type=number default=600 description="Timeout in seconds"
```
Props: `name` (required), `alias`, `type`, `default`, `required`, `description`

### `handler` — Action callback (existing node, uses <<< >>> blocks)
```
handler <<<
  const engines = opts.engines.split(',');
  await runForge(task, engines, opts);
>>>
```

## Example: agon.kern
```
cli name=agon version=2.0.0 description="Any AI can join. They compete. You ship."
  command name=forge description="Run competitive forge"
    arg name=task type=string required=true description="Task to implement"
    flag name=test alias=t type=string description="Fitness test command"
    flag name=timeout type=number default=600 description="Engine timeout"
    flag name=engines type=string default="claude,codex,gemini" description="Engines to use"
    handler <<<
      const engineList = opts.engines.split(',');
      await runForge(task, engineList, opts);
    >>>

  command name=brainstorm description="Multi-AI confidence bid"
    arg name=question type=string required=true description="Question to brainstorm"
    flag name=format type=string default="kern" description="Output format"
    handler <<<
      const drafts = await collectDrafts(question, opts);
      const ranked = await rankDrafts(drafts);
      display(ranked);
    >>>

  command name=tribunal description="Multi-AI debate"
    arg name=topic type=string required=true description="Topic to debate"
    flag name=rounds type=number default=3 description="Number of rounds"
    handler <<<
      await runTribunal(topic, opts);
    >>>
```

## Generated Output Structure

### `GeneratedArtifact[]` multi-file:

```
index.ts              ← entry point: #!/usr/bin/env node, program setup, register commands
commands/forge.ts     ← forge command: args, flags, action handler
commands/brainstorm.ts
commands/tribunal.ts
```

### index.ts (generated)
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { registerForge } from './commands/forge.js';
import { registerBrainstorm } from './commands/brainstorm.js';
import { registerTribunal } from './commands/tribunal.js';

const program = new Command();
program
  .name('agon')
  .version('2.0.0')
  .description('Any AI can join. They compete. You ship.');

registerForge(program);
registerBrainstorm(program);
registerTribunal(program);

program.parse();
```

### commands/forge.ts (generated)
```typescript
import type { Command } from 'commander';

export function registerForge(program: Command): void {
  program
    .command('forge')
    .description('Run competitive forge')
    .argument('<task>', 'Task to implement')
    .option('-t, --test <string>', 'Fitness test command')
    .option('--timeout <number>', 'Engine timeout', '600')
    .option('--engines <string>', 'Engines to use', 'claude,codex,gemini')
    .action(async (task: string, opts: { test?: string; timeout: string; engines: string }) => {
      const engineList = opts.engines.split(',');
      await runForge(task, engineList, opts);
    });
}
```

## Implementation

### New files
- `src/transpiler-cli.ts` — CLI transpiler (single file, follows Express pattern)
- `examples/agon.kern` — example CLI definition

### Modified files
- `src/config.ts` — add `'cli'` to `KernTarget` and `VALID_TARGETS`
- `src/cli.ts` — wire `transpileCliApp` into target dispatch
- `src/index.ts` — export `transpileCliApp`
- `tests/fitness.test.ts` — add CLI transpiler tests

### Architecture decisions
1. **Single transpiler-cli.ts** — consistent with all other targets
2. **Multi-file via GeneratedArtifact[]** — `index.ts` + `commands/*.ts`
3. **Handler blocks → verbatim in .action() callbacks** — no transformation
4. **`register*` pattern** — each command exports a register function, index.ts calls them
5. **Types from Commander** — `Command` type imported, opts typed from flags
6. **No runtime deps** — generated code only needs `commander` (user installs it)
7. **Frontend nodes silently ignored** — same pattern as Express target

### V1 scope (this PR)
- `cli`, `command`, `arg`, `flag`, `handler` nodes
- Flat commands (one level deep)
- Generated TypeScript with Commander.js

### V2 (future)
- `repl` node → readline/inquirer loop
- `process` node → child_process spawn wrappers
- Nested subcommands (command inside command)
- Global options inheritance

## Test plan
- Parse agon.kern → produces IRNode tree with cli/command/arg/flag/handler
- Transpile → generates index.ts with Commander setup
- Transpile → generates commands/*.ts per command
- Transpile → handler code appears verbatim in .action()
- Transpile → flags produce correct .option() calls
- Transpile → required args produce .argument('<name>')
- Transpile → optional args produce .argument('[name]')
- All existing 75 tests still pass

## Verification
1. `npx tsc --noEmit` — zero type errors
2. `npm test` — all tests pass
3. Manual: `kern examples/agon.kern --target=cli` produces valid Commander.js
