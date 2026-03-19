import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'KERN Playground',
  description: 'Interactive KERN compiler — paste .kern code, see compiled output for any target',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{
        margin: 0,
        padding: 0,
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        height: '100vh',
        overflow: 'hidden',
      }}>
        {children}
      </body>
    </html>
  );
}
