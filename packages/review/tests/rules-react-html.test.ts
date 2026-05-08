import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('React HTML quality rules', () => {
  describe('controlled-input-no-onchange', () => {
    it('flags <input value={x}> without onChange', () => {
      const src = `
import { useState } from 'react';
export function C() {
  const [v, setV] = useState('');
  return <input value={v} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeDefined();
    });

    it('flags <textarea value={x}> without onChange', () => {
      const src = `
import { useState } from 'react';
export function C() {
  const [v] = useState('');
  return <textarea value={v} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeDefined();
    });

    it('does not flag with onChange', () => {
      const src = `
import { useState } from 'react';
export function C() {
  const [v, setV] = useState('');
  return <input value={v} onChange={(e) => setV(e.target.value)} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeUndefined();
    });

    it('does not flag with readOnly', () => {
      const src = `
export function C() {
  return <input value="locked" readOnly />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeUndefined();
    });

    it('does not flag defaultValue (uncontrolled)', () => {
      const src = `
export function C() {
  return <input defaultValue="initial" />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeUndefined();
    });

    it('flags type="checkbox" with checked but no onChange (Gemini review: cover the checked case)', () => {
      const src = `
export function C({ checked }: { checked: boolean }) {
  return <input type="checkbox" checked={checked} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'controlled-input-no-onchange');
      expect(f).toBeDefined();
      expect(f!.message).toMatch(/checked/);
    });

    it('does not flag type="checkbox" with checked + onChange', () => {
      const src = `
export function C({ checked, onChange }: { checked: boolean; onChange: (e: any) => void }) {
  return <input type="checkbox" checked={checked} onChange={onChange} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeUndefined();
    });

    it('does not flag type="hidden"', () => {
      const src = `
export function C() {
  return <input type="hidden" value="abc" />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeUndefined();
    });

    it('does not flag spread attributes (could supply onChange)', () => {
      const src = `
export function C(props: any) {
  return <input value="x" {...props} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'controlled-input-no-onchange')).toBeUndefined();
    });
  });

  describe('form-onsubmit-no-preventdefault', () => {
    it('flags onSubmit handler without preventDefault', () => {
      const src = `
export function C() {
  return <form onSubmit={(e) => { console.log('submit'); }}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeDefined();
    });

    it('does not flag when handler calls e.preventDefault()', () => {
      const src = `
export function C() {
  return <form onSubmit={(e) => { e.preventDefault(); }}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeUndefined();
    });

    it('does not flag when handler calls event.preventDefault()', () => {
      const src = `
export function C() {
  return <form onSubmit={(event) => { event.preventDefault(); }}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeUndefined();
    });

    it('does not flag when handler is an external function reference', () => {
      const src = `
declare const handler: (e: any) => void;
export function C() {
  return <form onSubmit={handler}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      // Conservative: external handler is not inspected
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeUndefined();
    });

    it('does not flag when form has action attribute', () => {
      const src = `
export function C() {
  return <form action="/post" onSubmit={(e) => { /* server action */ }}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeUndefined();
    });

    it('does not flag when form has method attribute (Gemini review: cover dialog/post)', () => {
      const src = `
export function C() {
  return <form method="dialog" onSubmit={(e) => { /* dialog submit */ }}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeUndefined();
    });

    it('does not match preventDefault inside a comment (Gemini review: AST not regex)', () => {
      const src = `
export function C() {
  return <form onSubmit={(e) => {
    // TODO: call preventDefault() if needed
    console.log('submit');
  }}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeDefined();
    });

    it('does not flag concise body that calls preventDefault (Codex P2-2)', () => {
      const src = `
export function C() {
  return <form onSubmit={(e) => e.preventDefault()}>...</form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'form-onsubmit-no-preventdefault')).toBeUndefined();
    });
  });

  describe('submit-button-implicit-type', () => {
    it('flags <button> inside <form> without type', () => {
      const src = `
export function C() {
  return <form><button>Cancel</button></form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'submit-button-implicit-type')).toBeDefined();
    });

    it('does not flag <button type="button">', () => {
      const src = `
export function C() {
  return <form><button type="button">Cancel</button></form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'submit-button-implicit-type')).toBeUndefined();
    });

    it('does not flag <button type="submit">', () => {
      const src = `
export function C() {
  return <form><button type="submit">Save</button></form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'submit-button-implicit-type')).toBeUndefined();
    });

    it('does not flag <button> outside a form', () => {
      const src = `
export function C() {
  return <div><button>Click</button></div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'submit-button-implicit-type')).toBeUndefined();
    });

    it('does not flag <button> with spread attributes', () => {
      const src = `
export function C(props: any) {
  return <form><button {...props}>Save</button></form>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'submit-button-implicit-type')).toBeUndefined();
    });
  });

  describe('target-blank-no-rel-noopener', () => {
    it('flags <a target="_blank"> without rel', () => {
      const src = `
export function C() {
  return <a href="https://x.com" target="_blank">link</a>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'target-blank-no-rel-noopener')).toBeDefined();
    });

    it('flags target="_blank" with rel that omits noopener', () => {
      const src = `
export function C() {
  return <a href="https://x.com" target="_blank" rel="external">link</a>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'target-blank-no-rel-noopener')).toBeDefined();
    });

    it('does not flag with rel="noopener noreferrer"', () => {
      const src = `
export function C() {
  return <a href="https://x.com" target="_blank" rel="noopener noreferrer">link</a>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'target-blank-no-rel-noopener')).toBeUndefined();
    });

    it('does not flag with rel="noopener" alone', () => {
      const src = `
export function C() {
  return <a href="https://x.com" target="_blank" rel="noopener">link</a>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'target-blank-no-rel-noopener')).toBeUndefined();
    });

    it('does not flag <a target="_self">', () => {
      const src = `
export function C() {
  return <a href="https://x.com" target="_self">link</a>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'target-blank-no-rel-noopener')).toBeUndefined();
    });

    it('does not flag <a> without target', () => {
      const src = `
export function C() {
  return <a href="https://x.com">link</a>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'target-blank-no-rel-noopener')).toBeUndefined();
    });
  });
});
