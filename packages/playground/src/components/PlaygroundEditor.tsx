'use client';

import { useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { Monaco, OnMount } from '@monaco-editor/react';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// ── KERN Monarch Tokenizer ───────────────────────────────────────────────

const KERN_NODE_TYPES = [
  'screen', 'row', 'col', 'card', 'scroll',
  'text', 'image', 'progress', 'divider', 'codeblock',
  'section',
  'button', 'input', 'modal',
  'list', 'item',
  'tabs', 'tab', 'header',
  'theme',
  'server', 'route', 'middleware', 'handler', 'schema',
  'stream', 'spawn', 'timer', 'on', 'env', 'websocket',
  'cli', 'command', 'arg', 'flag', 'import',
  'separator', 'table', 'scoreboard', 'metric',
  'spinner', 'box', 'gradient',
  'state', 'repl', 'guard', 'parallel', 'dispatch', 'then', 'each',
  'generateMetadata', 'notFound', 'redirect', 'fetch',
  'type', 'interface', 'field', 'fn',
  'machine', 'transition',
  'error', 'module', 'export',
  'config', 'store',
  'test', 'describe', 'it',
  'event',
  'hook', 'provider', 'effect',
  'memo', 'callback', 'ref', 'context', 'cleanup',
  'prop', 'returns',
  'input-area', 'output-area', 'text-input', 'select-input',
  'template', 'slot', 'body',
  'derive', 'transform', 'action', 'assume', 'invariant',
  'branch', 'path', 'resolve', 'candidate', 'discriminator',
  'collect', 'pattern', 'apply', 'expect',
  'recover', 'strategy',
  'reason', 'evidence',
  'needs',
];

const KERN_SHORTHANDS = [
  'p', 'm', 'pt', 'pb', 'pl', 'pr', 'mt', 'mb', 'ml', 'mr',
  'w', 'h', 'f',
  'bg', 'c', 'bc',
  'fs', 'fw', 'ta',
  'br', 'bw',
  'jc', 'ai', 'fd',
  'shadow',
];

function registerKernLanguage(monaco: Monaco) {
  // Only register once
  if (monaco.languages.getLanguages().some(l => l.id === 'kern')) return;

  monaco.languages.register({ id: 'kern' });

  monaco.languages.setMonarchTokensProvider('kern', {
    keywords: KERN_NODE_TYPES,
    shorthands: KERN_SHORTHANDS,
    pseudoSelectors: [':press', ':hover', ':active', ':focus'],

    tokenizer: {
      root: [
        // Comments
        [/\/\/.*$/, 'comment'],

        // Handler blocks
        [/<<</, 'delimiter.handler'],
        [/>>>/, 'delimiter.handler'],

        // Strings
        [/"[^"]*"/, 'string'],

        // Style blocks: {bg:#fff,p:16}
        [/\{/, { token: 'delimiter.style', next: '@styleBlock' }],

        // Theme refs: $identifier
        [/\$[a-zA-Z_][\w]*/, 'variable.theme'],

        // Pseudo-selectors
        [/:(press|hover|active|focus)\b/, 'keyword.pseudo'],

        // Property assignments: name=, value=, type=, path=, method=
        [/[a-zA-Z_][\w-]*(?==)/, 'attribute.name'],

        // Numbers
        [/\b\d+(\.\d+)?\b/, 'number'],

        // Keywords (node types) — must be at start of a word
        [/[a-zA-Z_][\w-]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
      ],

      styleBlock: [
        // Shorthand keys inside style blocks
        [/[a-zA-Z_][\w]*/, {
          cases: {
            '@shorthands': 'attribute.shorthand',
            '@default': 'attribute.name',
          },
        }],
        // Hex colors
        [/#[0-9a-fA-F]{3,8}/, 'string.color'],
        // Numbers
        [/\d+(\.\d+)?/, 'number'],
        // Separators
        [/:/, 'delimiter'],
        [/,/, 'delimiter'],
        // Close
        [/\}/, { token: 'delimiter.style', next: '@pop' }],
      ],
    },
  });
}

// ── Error type ───────────────────────────────────────────────────────────

interface CompileError {
  message: string;
  line: number;
  col: number;
  codeFrame: string;
}

// ── Component ────────────────────────────────────────────────────────────

interface PlaygroundEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  height?: string;
  error?: CompileError | null;
}

export function PlaygroundEditor({
  value,
  onChange,
  language = 'plaintext',
  readOnly = false,
  height = '100%',
  error,
}: PlaygroundEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Update error markers when error prop changes
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    if (error && error.line > 0) {
      monacoRef.current.editor.setModelMarkers(model, 'kern', [{
        severity: monacoRef.current.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: error.line,
        startColumn: error.col || 1,
        endLineNumber: error.line,
        endColumn: error.col ? error.col + 20 : model.getLineMaxColumn(error.line),
      }]);
    } else {
      monacoRef.current.editor.setModelMarkers(model, 'kern', []);
    }
  }, [error]);

  return (
    <MonacoEditor
      height={height}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme="kern-dark"
      beforeMount={(monaco) => {
        registerKernLanguage(monaco);

        monaco.editor.defineTheme('kern-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'keyword', foreground: 'ff6b6b', fontStyle: 'bold' },
            { token: 'keyword.pseudo', foreground: 'c678dd' },
            { token: 'string', foreground: '4ecdc4' },
            { token: 'string.color', foreground: '4ecdc4' },
            { token: 'number', foreground: 'ffd166' },
            { token: 'comment', foreground: '6c757d' },
            { token: 'variable.theme', foreground: 'e5c07b' },
            { token: 'attribute.name', foreground: '61afef' },
            { token: 'attribute.shorthand', foreground: '56b6c2' },
            { token: 'delimiter.handler', foreground: 'c678dd', fontStyle: 'bold' },
            { token: 'delimiter.style', foreground: '8b949e' },
            { token: 'delimiter', foreground: '8b949e' },
            { token: 'identifier', foreground: 'abb2bf' },
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
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
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
