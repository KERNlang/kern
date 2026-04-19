import React, { useEffect, useInsertionEffect, useRef } from 'react';
import { Box, useStdin, useStdout } from 'ink';

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

export type AlternateScreenProps = {
  mouseTracking?: boolean;
  children?: React.ReactNode;
};

type InstanceState = {
  stdout: NodeJS.WriteStream;
  mouseTracking: boolean;
  cleanedUp: boolean;
};

const activeInstances = new Set<InstanceState>();
let signalHandlersAttached = false;
let signalHandlers: { cleanup: () => void; onInt: () => void; onTerm: () => void; onExcept: (e: unknown) => void } | null = null;

function runGlobalCleanup(): void {
  for (const inst of activeInstances) {
    if (inst.cleanedUp) continue;
    try {
      if (inst.mouseTracking) inst.stdout.write(DISABLE_MOUSE);
      inst.stdout.write(EXIT_ALT_SCREEN);
    } catch {
      // stream already closed
    }
    inst.cleanedUp = true;
  }
}

function attachSignalHandlers(): void {
  if (signalHandlersAttached) return;
  signalHandlersAttached = true;
  const cleanup = () => runGlobalCleanup();
  const onInt = () => {
    cleanup();
    process.exit(130);
  };
  const onTerm = () => {
    cleanup();
    process.exit(143);
  };
  const onExcept = (err: unknown) => {
    cleanup();
    throw err;
  };
  signalHandlers = { cleanup, onInt, onTerm, onExcept };
  process.on('exit', cleanup);
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('uncaughtException', onExcept);
}

function detachSignalHandlers(): void {
  if (!signalHandlersAttached || !signalHandlers) return;
  process.off('exit', signalHandlers.cleanup);
  process.off('SIGINT', signalHandlers.onInt);
  process.off('SIGTERM', signalHandlers.onTerm);
  process.off('uncaughtException', signalHandlers.onExcept);
  signalHandlers = null;
  signalHandlersAttached = false;
}

export function AlternateScreen({ mouseTracking = false, children }: AlternateScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const instanceRef = useRef<InstanceState | null>(null);

  useInsertionEffect(() => {
    const inst: InstanceState = { stdout, mouseTracking, cleanedUp: false };
    instanceRef.current = inst;
    stdout.write(ENTER_ALT_SCREEN);
    if (mouseTracking) stdout.write(ENABLE_MOUSE);
    activeInstances.add(inst);
    attachSignalHandlers();
    return () => {
      if (!inst.cleanedUp) {
        try {
          if (inst.mouseTracking) stdout.write(DISABLE_MOUSE);
          stdout.write(EXIT_ALT_SCREEN);
        } catch {
          // stream already closed
        }
        inst.cleanedUp = true;
      }
      activeInstances.delete(inst);
      instanceRef.current = null;
      if (activeInstances.size === 0) detachSignalHandlers();
    };
  }, [stdout, mouseTracking]);

  useEffect(() => {
    if (!mouseTracking || !isRawModeSupported) return;
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [mouseTracking, isRawModeSupported, setRawMode, stdin]);

  const rows = stdout.rows ?? 24;
  const columns = stdout.columns ?? 80;

  return (
    <Box flexDirection="column" width={columns} height={rows} flexShrink={0}>
      {children}
    </Box>
  );
}
