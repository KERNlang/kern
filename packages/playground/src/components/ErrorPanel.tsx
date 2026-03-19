'use client';

interface ErrorPanelProps {
  error: { message: string; line: number; col: number; codeFrame: string };
}

export function ErrorPanel({ error }: ErrorPanelProps) {
  return (
    <div style={{
      padding: 16,
      background: '#1a0000',
      borderTop: '2px solid #ff6b6b',
      height: '100%',
      overflow: 'auto',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
      }}>
        <span style={{ color: '#ff6b6b', fontSize: 14, fontWeight: 600 }}>Error</span>
        {error.line > 0 && (
          <span style={{ color: '#8b949e', fontSize: 12 }}>
            Line {error.line}, Col {error.col}
          </span>
        )}
      </div>
      <div style={{ color: '#f0a0a0', fontSize: 13, marginBottom: 12 }}>
        {error.message}
      </div>
      {error.codeFrame && (
        <pre style={{
          color: '#8b949e',
          fontSize: 12,
          lineHeight: 1.6,
          margin: 0,
          whiteSpace: 'pre-wrap',
        }}>
          {error.codeFrame}
        </pre>
      )}
    </div>
  );
}
