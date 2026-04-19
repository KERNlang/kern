import React, { useEffect, useInsertionEffect, useRef, useState } from 'react';
import { Box, useStdin, useStdout } from 'ink';
import { acquireAltScreen, acquireRawMode } from './terminal-mode.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

export type AlternateScreenProps = {
  mouseTracking?: boolean;
  children?: React.ReactNode;
};

type InstanceState = {
  release: () => void;
};

const activeInstances = new Set<InstanceState>();
let signalHandlers: { cleanup: () => void; onInt: () => void; onTerm: () => void; onExcept: (e: unknown) => void } | null = null;

function runGlobalCleanup(): void {
  for (const inst of activeInstances) {
    try {
      inst.release();
    } catch {
      // stream already closed
    }
  }
}

function attachSignalHandlers(): void {
  if (signalHandlers) return;
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
  if (!signalHandlers) return;
  process.off('exit', signalHandlers.cleanup);
  process.off('SIGINT', signalHandlers.onInt);
  process.off('SIGTERM', signalHandlers.onTerm);
  process.off('uncaughtException', signalHandlers.onExcept);
  signalHandlers = null;
}

export function AlternateScreen({ mouseTracking = false, children }: AlternateScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const [dimensions, setDimensions] = useState(() => ({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  }));
  const instanceRef = useRef<InstanceState | null>(null);

  useInsertionEffect(() => {
    const release = acquireAltScreen({
      enter: () => stdout.write(ENTER_ALT_SCREEN),
      exit: () => stdout.write(EXIT_ALT_SCREEN),
      enableMouse: mouseTracking ? () => stdout.write(ENABLE_MOUSE) : undefined,
      disableMouse: mouseTracking ? () => stdout.write(DISABLE_MOUSE) : undefined,
    });
    const inst: InstanceState = { release };
    instanceRef.current = inst;
    activeInstances.add(inst);
    attachSignalHandlers();
    return () => {
      release();
      activeInstances.delete(inst);
      instanceRef.current = null;
      if (activeInstances.size === 0) detachSignalHandlers();
    };
  }, [stdout, mouseTracking]);

  useEffect(() => {
    if (!mouseTracking) return;
    const release = acquireRawMode(setRawMode, isRawModeSupported);
    return () => {
      release();
    };
  }, [mouseTracking, isRawModeSupported, setRawMode, stdin]);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setDimensions({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return (
    <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} flexShrink={0}>
      {children}
    </Box>
  );
}
