let rawModeRefCount = 0;

export function acquireRawMode(setRawMode: (v: boolean) => void, supported: boolean): () => void {
  if (!supported) return () => undefined;
  if (rawModeRefCount === 0) setRawMode(true);
  rawModeRefCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rawModeRefCount -= 1;
    if (rawModeRefCount === 0) setRawMode(false);
  };
}

let altScreenRefCount = 0;
let mouseTrackingRefCount = 0;

type AltScreenOps = {
  enter: () => void;
  exit: () => void;
  enableMouse?: () => void;
  disableMouse?: () => void;
};

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // terminal stream already closed
  }
}

export function acquireAltScreen(ops: AltScreenOps): () => void {
  if (altScreenRefCount === 0) {
    ops.enter();
  }
  altScreenRefCount += 1;

  const tracksMouse = Boolean(ops.enableMouse && ops.disableMouse);
  if (tracksMouse) {
    if (mouseTrackingRefCount === 0) ops.enableMouse!();
    mouseTrackingRefCount += 1;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;

    if (tracksMouse) {
      mouseTrackingRefCount -= 1;
      if (mouseTrackingRefCount === 0) {
        safeCall(ops.disableMouse!);
      }
    }

    altScreenRefCount -= 1;
    if (altScreenRefCount === 0) {
      safeCall(ops.exit);
    }
  };
}

export function getAltScreenActiveCount(): number {
  return altScreenRefCount;
}
