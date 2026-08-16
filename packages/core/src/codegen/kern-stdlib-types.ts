export interface StdlibCallEntry {
  kind?: 'call';
  arity?: number;
  minArity?: number;
  maxArity?: number;
  variadic?: boolean;
  ts: string | ((args: string[]) => string);
  py: string | ((args: string[]) => string);
  /** Per-target imports required when this lowering is used. */
  requires?: { ts?: string; py?: string };
}

export interface StdlibPropertyEntry {
  kind: 'property';
  ts: string;
  py: string;
  requires?: { ts?: string; py?: string };
}

export type StdlibEntry = StdlibCallEntry | StdlibPropertyEntry;
