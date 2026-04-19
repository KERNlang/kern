import React, { useEffect, useInsertionEffect } from 'react';
import { Box, useStdin, useStdout } from 'ink';

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

export type AlternateScreenProps = {
  mouseTracking?: boolean;
  children?: React.ReactNode;
};

let altScreenCleanupRegistered = false;
const altScreenCleanupState = { active: false, mouse: false };

function registerSignalCleanup(stdout: NodeJS.WriteStream): void {
  if (altScreenCleanupRegistered) return;
  altScreenCleanupRegistered = true;
  const cleanup = () => {
    if (!altScreenCleanupState.active) return;
    try {
      if (altScreenCleanupState.mouse) stdout.write(DISABLE_MOUSE);
      stdout.write(EXIT_ALT_SCREEN);
    } catch {
      // terminal already closed, nothing to do
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  process.on('uncaughtException', (err) => {
    cleanup();
    throw err;
  });
}

export function AlternateScreen({ mouseTracking = false, children }: AlternateScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();

  useInsertionEffect(() => {
    stdout.write(ENTER_ALT_SCREEN);
    if (mouseTracking) stdout.write(ENABLE_MOUSE);
    altScreenCleanupState.active = true;
    altScreenCleanupState.mouse = mouseTracking;
    registerSignalCleanup(stdout);
    return () => {
      if (mouseTracking) stdout.write(DISABLE_MOUSE);
      stdout.write(EXIT_ALT_SCREEN);
      altScreenCleanupState.active = false;
      altScreenCleanupState.mouse = false;
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
