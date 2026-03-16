import { Project } from 'ts-morph';
import { detectTemplates } from '../src/template-detector.js';

function detect(source: string) {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sf = project.createSourceFile('test.ts', source);
  return detectTemplates(sf);
}

describe('Template Detector', () => {
  describe('zustand', () => {
    it('detects zustand store pattern', () => {
      const source = `
import { create } from 'zustand';

interface BearState { bears: number; increase: () => void; }

const useBearStore = create<BearState>((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}));`;
      const matches = detect(source);
      const zustand = matches.find(m => m.templateName === 'zustand-store');
      expect(zustand).toBeDefined();
      expect(zustand!.confidencePct).toBeGreaterThanOrEqual(85);
      expect(zustand!.libraryName).toBe('zustand');
    });
  });

  describe('SWR', () => {
    it('detects SWR hook pattern', () => {
      const source = `
import useSWR from 'swr';

function useUser(id: string) {
  const { data, error } = useSWR(\`/api/user/\${id}\`, fetcher);
  return { user: data, isLoading: !data && !error, error };
}`;
      const matches = detect(source);
      const swr = matches.find(m => m.templateName === 'swr-hook');
      expect(swr).toBeDefined();
      expect(swr!.confidencePct).toBeGreaterThanOrEqual(85);
    });
  });

  describe('TanStack Query', () => {
    it('detects useQuery pattern', () => {
      const source = `
import { useQuery } from '@tanstack/react-query';

function useTodos() {
  return useQuery({ queryKey: ['todos'], queryFn: fetchTodos });
}`;
      const matches = detect(source);
      const query = matches.find(m => m.templateName === 'query-hook');
      expect(query).toBeDefined();
      expect(query!.libraryName).toBe('TanStack Query');
    });
  });

  describe('Zod', () => {
    it('detects zod schema pattern', () => {
      const source = `
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});`;
      const matches = detect(source);
      const zod = matches.find(m => m.templateName === 'zod-schema');
      expect(zod).toBeDefined();
      expect(zod!.libraryName).toBe('Zod');
    });
  });

  describe('Jotai', () => {
    it('detects jotai atom pattern', () => {
      const source = `
import { atom } from 'jotai';

const countAtom = atom(0);
const doubleAtom = atom((get) => get(countAtom) * 2);`;
      const matches = detect(source);
      const jotai = matches.find(m => m.templateName === 'jotai-atom');
      expect(jotai).toBeDefined();
      expect(jotai!.libraryName).toBe('Jotai');
    });
  });

  describe('no matches', () => {
    it('returns empty for plain TypeScript', () => {
      const source = `
export function hello(name: string): string {
  return \`Hello \${name}\`;
}`;
      const matches = detect(source);
      expect(matches.length).toBe(0);
    });
  });
});
