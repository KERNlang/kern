import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, measureElement, useStdin, useStdout } from 'ink';

export type ScrollBoxHandle = {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  getScrollTop(): number;
  getScrollHeight(): number;
  getFreshScrollHeight(): number;
  getViewportHeight(): number;
  getViewportTop(): number;
  isSticky(): boolean;
  setClampBounds(min: number, max: number): void;
  subscribe(listener: (scrollTop: number) => void): () => void;
};

export type ScrollBoxProps = {
  stickyScroll?: boolean;
  flexGrow?: number;
  flexShrink?: number;
  height?: number;
  rowHeight?: number;
  children?: React.ReactNode;
};

const SGR_MOUSE_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

function parseWheelDelta(chunk: string): number {
  let delta = 0;
  SGR_MOUSE_PATTERN.lastIndex = 0;
  let match = SGR_MOUSE_PATTERN.exec(chunk);
  while (match !== null) {
    const button = Number(match[1]);
    const low = button & 3;
    const extra = button & ~3;
    if (extra === 64 && low === 0) delta -= 3;
    else if (extra === 64 && low === 1) delta += 3;
    match = SGR_MOUSE_PATTERN.exec(chunk);
  }
  return delta;
}

let rawModeRefCount = 0;

function acquireRawMode(setRawMode: (v: boolean) => void, supported: boolean): () => void {
  if (!supported) return () => undefined;
  if (rawModeRefCount === 0) setRawMode(true);
  rawModeRefCount += 1;
  return () => {
    rawModeRefCount -= 1;
    if (rawModeRefCount === 0) setRawMode(false);
  };
}

export const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(function ScrollBox(
  { stickyScroll = false, flexGrow, flexShrink, height, rowHeight = 1, children },
  ref,
) {
  const { stdin, isRawModeSupported, setRawMode } = useStdin();
  const { stdout } = useStdout();

  const childArray = useMemo(() => React.Children.toArray(children), [children]);
  const totalRows = childArray.length * rowHeight;

  const [viewportRows, setViewportRows] = useState<number>(() => {
    if (typeof height === 'number') return height;
    return stdout?.rows ?? 24;
  });

  const [scrollTop, setScrollTop] = useState(() => {
    if (!stickyScroll) return 0;
    const initialViewport = typeof height === 'number' ? height : (stdout?.rows ?? 24);
    const initialTotal = React.Children.count(children) * rowHeight;
    return Math.max(0, initialTotal - initialViewport);
  });

  const [clampMin, setClampMin] = useState(0);
  const [clampMax, setClampMax] = useState(Number.POSITIVE_INFINITY);
  const stickyRef = useRef(stickyScroll);
  const listenersRef = useRef<Set<(top: number) => void>>(new Set());
  const containerRef = useRef<React.ElementRef<typeof Box> | null>(null);
  const stdinBufferRef = useRef<string>('');
  const latestRef = useRef({
    scrollTop: 0,
    viewportRows: viewportRows,
    totalRows: totalRows,
    clampMin: 0,
    clampMax: Number.POSITIVE_INFINITY,
    stickyScroll,
  });

  useEffect(() => {
    stickyRef.current = stickyScroll;
  }, [stickyScroll]);

  const maxScroll = Math.max(0, Math.min(clampMax, totalRows - viewportRows));
  const minScroll = Math.max(0, clampMin);

  const clamp = useCallback(
    (value: number) => Math.max(minScroll, Math.min(maxScroll, value)),
    [minScroll, maxScroll],
  );

  useEffect(() => {
    latestRef.current = {
      scrollTop,
      viewportRows,
      totalRows,
      clampMin: minScroll,
      clampMax: maxScroll,
      stickyScroll,
    };
  });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const measured = measureElement(containerRef.current);
    const measuredHeight = measured?.height ?? 0;
    if (measuredHeight > 0 && measuredHeight !== viewportRows) {
      setViewportRows(measuredHeight);
    } else if (typeof height === 'number' && height !== viewportRows) {
      setViewportRows(height);
    }
  });

  useLayoutEffect(() => {
    setScrollTop((prev) => {
      const next = clamp(prev);
      return next === prev ? prev : next;
    });
  }, [clamp]);

  useLayoutEffect(() => {
    if (!stickyRef.current) return;
    setScrollTop(maxScroll);
  }, [totalRows, maxScroll]);

  const notifyImperative = useCallback((top: number) => {
    for (const listener of listenersRef.current) listener(top);
  }, []);

  useEffect(() => {
    if (!stdin || !isRawModeSupported) return;
    const release = acquireRawMode(setRawMode, isRawModeSupported);
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      stdinBufferRef.current += text;
      const buf = stdinBufferRef.current;
      const lastComplete = Math.max(buf.lastIndexOf('M'), buf.lastIndexOf('m'));
      if (lastComplete === -1) return;
      const toParse = buf.slice(0, lastComplete + 1);
      stdinBufferRef.current = buf.slice(lastComplete + 1);
      const delta = parseWheelDelta(toParse);
      if (delta === 0) return;
      setScrollTop((prev) => {
        const { clampMin: cMin, clampMax: cMax, stickyScroll: s } = latestRef.current;
        const next = Math.max(cMin, Math.min(cMax, prev + delta));
        if (next !== cMax) stickyRef.current = false;
        else if (s) stickyRef.current = true;
        return next;
      });
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      release();
    };
  }, [stdin, isRawModeSupported, setRawMode]);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo(y: number) {
        setScrollTop((_prev) => {
          const { clampMin: cMin, clampMax: cMax, stickyScroll: s } = latestRef.current;
          const next = Math.max(cMin, Math.min(cMax, y));
          stickyRef.current = next === cMax && s;
          notifyImperative(next);
          return next;
        });
      },
      scrollBy(dy: number) {
        setScrollTop((prev) => {
          const { clampMin: cMin, clampMax: cMax, stickyScroll: s } = latestRef.current;
          const next = Math.max(cMin, Math.min(cMax, prev + dy));
          stickyRef.current = next === cMax && s;
          notifyImperative(next);
          return next;
        });
      },
      scrollToBottom() {
        stickyRef.current = stickyRef.current || latestRef.current.stickyScroll;
        const target = latestRef.current.clampMax;
        setScrollTop(target);
        notifyImperative(target);
      },
      getScrollTop: () => latestRef.current.scrollTop,
      getScrollHeight: () => latestRef.current.totalRows,
      getFreshScrollHeight: () => React.Children.count(children) * rowHeight,
      getViewportHeight: () => latestRef.current.viewportRows,
      getViewportTop: () => latestRef.current.scrollTop,
      isSticky: () => stickyRef.current,
      setClampBounds(min: number, max: number) {
        setClampMin(min);
        setClampMax(max);
      },
      subscribe(listener: (top: number) => void) {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [notifyImperative, children, rowHeight],
  );

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight));
  const endScroll = scrollTop + viewportRows;
  const endIndex = Math.min(childArray.length, Math.ceil(endScroll / rowHeight));
  const visible = childArray.slice(startIndex, endIndex);

  return (
    <Box
      ref={containerRef}
      flexDirection="column"
      overflow="hidden"
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      height={height}
    >
      {visible}
    </Box>
  );
});
