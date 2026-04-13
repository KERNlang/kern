import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('a11y Rules', () => {
  describe('img-missing-alt', () => {
    it('flags img without alt', () => {
      const src = `export function C() { return <img src="/x.jpg" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'img-missing-alt');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
      expect(f!.autofix!.replacement).toBe(' alt=""');
    });

    it('does not flag img with alt=""', () => {
      const src = `export function C() { return <img src="/x.jpg" alt="" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'img-missing-alt')).toBeUndefined();
    });

    it('does not flag img with role="presentation"', () => {
      const src = `export function C() { return <img src="/x.jpg" role="presentation" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'img-missing-alt')).toBeUndefined();
    });
  });

  describe('button-missing-name', () => {
    it('flags self-closing button with no name', () => {
      const src = `export function C() { return <button className="icon" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'button-missing-name')).toBeDefined();
    });

    it('does not flag button with aria-label', () => {
      const src = `export function C() { return <button aria-label="Close" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'button-missing-name')).toBeUndefined();
    });

    it('does not flag button with text content', () => {
      const src = `export function C() { return <button>Click me</button>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'button-missing-name')).toBeUndefined();
    });
  });

  describe('label-missing-for', () => {
    it('flags label without htmlFor and no nested control', () => {
      const src = `export function C() { return <label>Name</label>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'label-missing-for')).toBeDefined();
    });

    it('does not flag label with htmlFor', () => {
      const src = `export function C() { return <label htmlFor="n">Name</label>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'label-missing-for')).toBeUndefined();
    });

    it('does not flag label with nested input', () => {
      const src = `export function C() { return <label>Name <input name="n" /></label>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'label-missing-for')).toBeUndefined();
    });
  });

  describe('aria-invalid-role', () => {
    it('flags invalid role value', () => {
      const src = `export function C() { return <div role="buttonn">x</div>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'aria-invalid-role')).toBeDefined();
    });

    it('does not flag valid role', () => {
      const src = `export function C() { return <div role="button" tabIndex={0}>x</div>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'aria-invalid-role')).toBeUndefined();
    });
  });

  describe('interactive-noninteractive', () => {
    it('flags div with onClick and no role/tabIndex', () => {
      const src = `export function C() { return <div onClick={() => {}}>click</div>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'interactive-noninteractive')).toBeDefined();
    });

    it('does not flag div with onClick + role + tabIndex', () => {
      const src = `export function C() { return <div onClick={() => {}} role="button" tabIndex={0}>x</div>; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'interactive-noninteractive')).toBeUndefined();
    });
  });
});
