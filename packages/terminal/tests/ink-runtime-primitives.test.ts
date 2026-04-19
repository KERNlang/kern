import { PassThrough } from 'stream';

const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
const runtimeTest = NODE_MAJOR >= 22 ? test : test.skip;

class TtyInput extends PassThrough {
  isTTY = true;
  setRawMode(_value: boolean): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

class TtyOutput extends PassThrough {
  isTTY = true;
  columns = 80;
  rows = 10;
  cursorTo(): boolean {
    return true;
  }
  moveCursor(): boolean {
    return true;
  }
  clearLine(): boolean {
    return true;
  }
  clearScreenDown(): boolean {
    return true;
  }
  getColorDepth(): number {
    return 8;
  }
  hasColors(): boolean {
    return true;
  }
}

async function waitForText(readText: () => string, expected: string, timeoutMs = 1500, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (readText().includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for output to contain '${expected}'. Current output:\n${readText()}`);
}

function setupRender() {
  const stdin = new TtyInput();
  const stdout = new TtyOutput();
  const stderr = new TtyOutput();
  let stdoutText = '';
  let stderrText = '';
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  stdout.on('data', (chunk: string | Buffer) => {
    stdoutText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });
  stderr.on('data', (chunk: string | Buffer) => {
    stderrText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });
  return {
    stdin,
    stdout,
    stderr,
    getStdout: () => stdoutText,
    getStderr: () => stderrText,
    resetStdout: () => {
      stdoutText = '';
    },
  };
}

describe('Ink runtime primitives', () => {
  runtimeTest('AlternateScreen writes ENTER_ALT_SCREEN before first content frame', async () => {
    const React = (await import('react')).default;
    const { render, Text } = await import('ink');
    const { AlternateScreen } = await import('../src/runtime/index.js');

    const { stdin, stdout, stderr, getStdout, getStderr } = setupRender();
    const element = React.createElement(AlternateScreen, null, React.createElement(Text, null, 'HELLO'));
    const app = render(element, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      await waitForText(getStdout, 'HELLO');
      const text = getStdout();
      const altIdx = text.indexOf('\x1b[?1049h');
      const helloIdx = text.indexOf('HELLO');
      expect(altIdx).toBeGreaterThanOrEqual(0);
      expect(helloIdx).toBeGreaterThanOrEqual(0);
      expect(altIdx).toBeLessThan(helloIdx);
      expect(getStderr()).toBe('');
    } finally {
      app.unmount();
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });

  runtimeTest('ScrollBox renders only visible slice, not all children', async () => {
    const React = (await import('react')).default;
    const { render, Text } = await import('ink');
    const { ScrollBox } = await import('../src/runtime/index.js');

    const { stdin, stdout, stderr, getStdout, getStderr } = setupRender();
    const rows = Array.from({ length: 100 }, (_, i) =>
      React.createElement(Text, { key: i }, `row-${String(i).padStart(3, '0')}`),
    );
    const element = React.createElement(ScrollBox, { height: 5, rowHeight: 1 }, rows);
    const app = render(element, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      await waitForText(getStdout, 'row-000');
      const text = getStdout();
      expect(text).toContain('row-000');
      expect(text).toContain('row-004');
      expect(text).not.toContain('row-099');
      expect(text).not.toContain('row-050');
      const rowMatches = text.match(/row-\d{3}/g) ?? [];
      const unique = new Set(rowMatches);
      expect(unique.size).toBeLessThanOrEqual(7);
      expect(getStderr()).toBe('');
    } finally {
      app.unmount();
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });

  runtimeTest('ScrollBox with stickyScroll pins to bottom and follows content growth', async () => {
    const React = (await import('react')).default;
    const { render, Text } = await import('ink');
    const { ScrollBox } = await import('../src/runtime/index.js');

    const { stdin, stdout, stderr, getStdout, getStderr, resetStdout } = setupRender();

    function makeRows(count: number) {
      return Array.from({ length: count }, (_, i) =>
        React.createElement(Text, { key: i }, `row-${String(i).padStart(3, '0')}`),
      );
    }

    const initialElement = React.createElement(
      ScrollBox,
      { stickyScroll: true, height: 3, rowHeight: 1 },
      makeRows(10),
    );
    const app = render(initialElement, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      await waitForText(getStdout, 'row-009');
      let text = getStdout();
      expect(text).toContain('row-007');
      expect(text).toContain('row-009');

      resetStdout();
      app.rerender(React.createElement(ScrollBox, { stickyScroll: true, height: 3, rowHeight: 1 }, makeRows(15)));
      await app.waitUntilRenderFlush();
      await waitForText(getStdout, 'row-014');
      text = getStdout();
      expect(text).toContain('row-012');
      expect(text).toContain('row-014');
      expect(getStderr()).toBe('');
    } finally {
      app.unmount();
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });

  runtimeTest('ScrollBox with flexGrow inside fixed-height parent measures actual viewport', async () => {
    const React = (await import('react')).default;
    const { Box, render, Text } = await import('ink');
    const { ScrollBox } = await import('../src/runtime/index.js');

    const { stdin, stdout, stderr, getStdout, getStderr } = setupRender();
    const rows = Array.from({ length: 50 }, (_, i) =>
      React.createElement(Text, { key: i }, `row-${String(i).padStart(3, '0')}`),
    );
    const scrollBox = React.createElement(ScrollBox, { flexGrow: 1, rowHeight: 1 }, rows);
    const wrapper = React.createElement(Box, { flexDirection: 'column', height: 6 }, scrollBox);
    const app = render(wrapper, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      await waitForText(getStdout, 'row-000');
      const text = getStdout();
      expect(text).toContain('row-000');
      expect(text).not.toContain('row-020');
      expect(text).not.toContain('row-049');
      expect(getStderr()).toBe('');
    } finally {
      app.unmount();
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });

  runtimeTest('ScrollBox mouse wheel down shifts scrollTop via SGR sequence', async () => {
    const React = (await import('react')).default;
    const { render, Text } = await import('ink');
    const { ScrollBox } = await import('../src/runtime/index.js');

    const { stdin, stdout, stderr, getStdout, getStderr } = setupRender();
    const rows = Array.from({ length: 30 }, (_, i) =>
      React.createElement(Text, { key: i }, `row-${String(i).padStart(3, '0')}`),
    );
    const element = React.createElement(ScrollBox, { height: 5, rowHeight: 1 }, rows);
    const app = render(element, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      await waitForText(getStdout, 'row-000');
      expect(getStdout()).not.toContain('row-010');

      stdin.write('\x1b[<65;10;10M');
      stdin.write('\x1b[<65;10;10M');

      await waitForText(getStdout, 'row-007');
      expect(getStderr()).toBe('');
    } finally {
      app.unmount();
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });
});
