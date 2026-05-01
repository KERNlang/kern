export interface Bag {
  [key: string]: number;
}

export interface Frozen {
  readonly [key: string]: unknown;
}

export type Box<T> = { value: T };
export type Pair<K, V> = [K, V];

export enum Direction {
  Up = 'UP',
  Down = 'DOWN',
}

export function add(a: number, b: number): number;
export function add(a: string, b: string): string;
export function add(a: any, b: any): any {
  return a + b;
}

export function identity<T>(value: T): T {
  return value;
}

export class Container<T> {
  value!: T;

  constructor(value: T) {
    this.value = value;
  }

  bar<U>(input: U): U {
    return input;
  }
}

export const lookup = new Map([
  ['foo', 1],
  ['bar', 2],
]);

export const roles = new Set(['admin', 'user']);

const user = { id: 'u1', email: 'u1@example.com' };
export const { id, email: mail } = user;

const pair = ['left', 'right'] as const;
export const [first, second] = pair;
