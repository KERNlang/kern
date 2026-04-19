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
import { Box, useStdin } from 'ink';

export type ScrollBoxHandle = {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  getScrollTop(): number;
  getScrollHeight(): number;
  getViewportHeight(): number;
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
    if (button === 64) delta -= 3;
    else if (button === 65) delta += 3;
    match = SGR_MOUSE_PATTERN.exec(chunk);
  }
  return delta;
}

export const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(function ScrollBox(
  { stickyScroll = false, flexGrow, flexShrink, height, rowHeight = 1, children },
  ref,
) {
  const { stdin, isRawModeSupported, setRawMode } = useStdin();

  const childArray = useMemo(() => React.Children.toArray(children), [children]);
  const totalRows = childArray.length * rowHeight;

  const [viewportRows, setViewportRows] = useState<number>(height ?? 24);
  const [scrollTop, setScrollTop] = useState(() => {
    if (!stickyScroll) return 0;
    const initialViewport = height ?? 24;
    const initialTotal = React.Children.count(children) * rowHeight;
    return Math.max(0, initialTotal - initialViewport);
  });
  const [clampMin, setClampMin] = useState(0);
  const [clampMax, setClampMax] = useState(Number.POSITIVE_INFINITY);
  const stickyRef = useRef(stickyScroll);
  const listenersRef = useRef<Set<(top: number) => void>>(new Set());
  const containerRef = useRef<React.ElementRef<typeof Box> | null>(null);

  const maxScroll = Math.max(0, Math.min(clampMax, totalRows - viewportRows));
  const minScroll = Math.max(0, clampMin);

  const clamp = useCallback(
    (value: number) => Math.max(minScroll, Math.min(maxScroll, value)),
    [minScroll, maxScroll],
  );

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

  useEffect(() => {
    for (const listener of listenersRef.current) listener(scrollTop);
  }, [scrollTop]);

  useEffect(() => {
    if (!stdin || !isRawModeSupported) return;
    setRawMode(true);
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      const delta = parseWheelDelta(text);
      if (delta === 0) return;
      setScrollTop((prev) => {
        const next = clamp(prev + delta);
        if (next !== maxScroll) stickyRef.current = false;
        else if (stickyScroll) stickyRef.current = true;
        return next;
      });
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, isRawModeSupported, setRawMode, clamp, maxScroll, stickyScroll]);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo(y: number) {
        setScrollTop((_) => {
          const next = clamp(y);
          stickyRef.current = next === maxScroll && stickyScroll;
          return next;
        });
      },
      scrollBy(dy: number) {
        setScrollTop((prev) => {
          const next = clamp(prev + dy);
          stickyRef.current = next === maxScroll && stickyScroll;
          return next;
        });
      },
      scrollToBottom() {
        stickyRef.current = stickyScroll;
        setScrollTop(maxScroll);
      },
      getScrollTop: () => scrollTop,
      getScrollHeight: () => totalRows,
      getViewportHeight: () => viewportRows,
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
    [clamp, maxScroll, scrollTop, stickyScroll, totalRows, viewportRows],
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
