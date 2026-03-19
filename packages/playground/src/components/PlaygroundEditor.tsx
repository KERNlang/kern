'use client';

import dynamic from 'next/dynamic';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface PlaygroundEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  height?: string;
}

export function PlaygroundEditor({ value, onChange, language = 'plaintext', readOnly = false, height = '100%' }: PlaygroundEditorProps) {
  return (
    <MonacoEditor
      height={height}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme="kern-dark"
      beforeMount={(monaco) => {
        monaco.editor.defineTheme('kern-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'keyword', foreground: 'ff6b6b', fontStyle: 'bold' },
            { token: 'string', foreground: '4ecdc4' },
            { token: 'number', foreground: 'ffd166' },
            { token: 'comment', foreground: '6c757d' },
          ],
          colors: {
            'editor.background': '#0d1117',
            'editor.foreground': '#e6edf3',
            'editor.lineHighlightBackground': '#161b22',
            'editor.selectionBackground': '#264f78',
            'editorLineNumber.foreground': '#484f58',
            'editorLineNumber.activeForeground': '#e6edf3',
          },
        });
      }}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'line',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
    />
  );
}
