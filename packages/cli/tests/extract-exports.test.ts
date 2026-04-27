/** Tests for extractExportsFromLines — used by barrel/facade generation.
 *
 *  Regression coverage for the const-enum case (Codex review of slice 2b):
 *  the previous regex `(?:function*?|class|const|enum|abstract\s+class)` matched
 *  `const` first for `export const enum Flag { ... }` and captured the keyword
 *  `enum` as the identifier instead of `Flag`, producing broken barrel entries. */

import { extractExportsFromLines } from '../src/shared.js';

describe('extractExportsFromLines', () => {
  test('export const enum captures the enum name, not "enum"', () => {
    expect(extractExportsFromLines(['export const enum Flag { On, Off }'])).toEqual([
      { name: 'Flag', typeOnly: false },
    ]);
  });

  test('export enum captures the enum name', () => {
    expect(extractExportsFromLines(['export enum Direction { Up, Down }'])).toEqual([
      { name: 'Direction', typeOnly: false },
    ]);
  });

  test('export const captures the const name (regression)', () => {
    expect(extractExportsFromLines(['export const KERN_VERSION = "3.4.0";'])).toEqual([
      { name: 'KERN_VERSION', typeOnly: false },
    ]);
  });

  test('export class captures the class name', () => {
    expect(extractExportsFromLines(['export class UserService {}'])).toEqual([
      { name: 'UserService', typeOnly: false },
    ]);
  });

  test('export function captures the function name', () => {
    expect(extractExportsFromLines(['export function getUser() {}'])).toEqual([{ name: 'getUser', typeOnly: false }]);
  });

  test('export interface captures the interface name as type-only', () => {
    expect(extractExportsFromLines(['export interface User { id: string }'])).toEqual([
      { name: 'User', typeOnly: true },
    ]);
  });

  test('export type captures the type alias as type-only', () => {
    expect(extractExportsFromLines(['export type Status = "a" | "b";'])).toEqual([{ name: 'Status', typeOnly: true }]);
  });

  test('mixed forms are extracted in order', () => {
    expect(
      extractExportsFromLines([
        'export const enum Flag { On, Off }',
        'export type Status = "a" | "b";',
        'export class UserService {}',
        'export const x = 1;',
      ]),
    ).toEqual([
      { name: 'Flag', typeOnly: false },
      { name: 'Status', typeOnly: true },
      { name: 'UserService', typeOnly: false },
      { name: 'x', typeOnly: false },
    ]);
  });

  // Slice 2e — function overloads share the same `export function name`
  // prefix line for each signature + the implementation. Without dedup the
  // generated barrel would emit `export { add, add, add }` (TS error).
  test('deduplicates same-name overload + implementation', () => {
    expect(
      extractExportsFromLines([
        'export function add(a: number, b: number): number;',
        'export function add(a: string, b: string): string;',
        'export function add(a: any, b: any): any {',
        '  return a + b;',
        '}',
      ]),
    ).toEqual([{ name: 'add', typeOnly: false }]);
  });

  test('value and type with same name (TS namespace merging) coexist', () => {
    // TS allows `export type X` and `export const X` simultaneously (different namespaces).
    const lines = ['export const Color = { red: "#f00" } as const;', 'export type Color = "red" | "blue";'];
    expect(extractExportsFromLines(lines)).toEqual([
      { name: 'Color', typeOnly: false },
      { name: 'Color', typeOnly: true },
    ]);
  });
});
