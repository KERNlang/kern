'use client';

interface StatsBarProps {
  stats: { irTokens: number; outputTokens: number; reduction: number } | null;
  artifactCount: number;
  isLoading: boolean;
}

export function StatsBar({ stats, artifactCount, isLoading }: StatsBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      borderTop: '1px solid #30363d',
      background: '#161b22',
      fontSize: 12,
      color: '#8b949e',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {isLoading ? (
          <span style={{ color: '#ffd166' }}>Compiling...</span>
        ) : stats ? (
          <>
            <span>
              <span style={{ color: '#4ecdc4' }}>{stats.irTokens}</span> tokens
              {' → '}
              <span style={{ color: '#ff6b6b' }}>{stats.outputTokens}</span> tokens
            </span>
            <span style={{
              color: stats.reduction > 0 ? '#4ecdc4' : '#ff6b6b',
              fontWeight: 600,
            }}>
              ({Math.round(stats.reduction)}% {stats.reduction > 0 ? 'reduction' : 'expansion'})
            </span>
          </>
        ) : (
          <span>Ready</span>
        )}
      </div>
      {artifactCount > 0 && (
        <span>{artifactCount} artifact{artifactCount !== 1 ? 's' : ''}</span>
      )}
    </div>
  );
}
