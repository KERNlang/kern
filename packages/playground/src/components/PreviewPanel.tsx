'use client';

import { useMemo } from 'react';
import { buildPreviewHtml } from '@/lib/preview-templates';
import type { PlaygroundTarget } from '@/lib/targets';

interface PreviewPanelProps {
  compiledCode: string;
  target: PlaygroundTarget;
}

export function PreviewPanel({ compiledCode, target }: PreviewPanelProps) {
  const html = useMemo(
    () => buildPreviewHtml(compiledCode, target),
    [compiledCode, target],
  );

  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: '#f8f9fa',
        borderRadius: 0,
      }}
      title="KERN Preview"
    />
  );
}
