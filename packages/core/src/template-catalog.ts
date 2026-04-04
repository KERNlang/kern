/**
 * Kern Template Catalog — built-in templates for popular libraries
 *
 * `kern init-templates` reads package.json, matches against this catalog,
 * and scaffolds template .kern files for detected libraries.
 *
 * Any AI assistant just runs `kern init-templates` and the project is ready.
 */

export interface CatalogEntry {
  /** npm package name that triggers this template */
  packageName: string;
  /** Human-friendly library name */
  libraryName: string;
  /** Template files to scaffold: filename → content */
  templates: Record<string, string>;
}

// ── Zustand ─────────────────────────────────────────────────────────────

const ZUSTAND_STORE = `template name=zustand-store
  slot name=storeName type=identifier
  slot name=stateType type=identifier
  import from=zustand names=create
  body <<<
    export const use{{storeName}}Store = create<{{stateType}}>((set, get) => ({
      {{CHILDREN}}
    }));
  >>>
`;

const ZUSTAND_SELECTOR = `template name=zustand-selector
  slot name=selectorName type=identifier
  slot name=stateType type=identifier
  slot name=field type=expr
  body <<<
    export const select{{selectorName}} = (s: {{stateType}}) => s.{{field}};
  >>>
`;

// ── SWR ─────────────────────────────────────────────────────────────────

const SWR_HOOK = `template name=swr-hook
  slot name=hookName type=identifier
  slot name=cacheKey type=expr
  slot name=fetcher type=expr optional=true default=defaultFetcher
  import from=swr names=useSWR
  body <<<
    export function {{hookName}}() {
      const { data, error, isLoading } = useSWR(
        {{cacheKey}},
        {{fetcher}}
      );

      {{CHILDREN}}

      return { data, error, isLoading };
    }
  >>>
`;

// ── React Query / TanStack Query ────────────────────────────────────────

const REACT_QUERY_HOOK = `template name=query-hook
  slot name=hookName type=identifier
  slot name=queryKey type=expr
  slot name=queryFn type=expr
  import from=@tanstack/react-query names=useQuery
  body <<<
    export function {{hookName}}() {
      const { data, error, isLoading, refetch } = useQuery({
        queryKey: [{{queryKey}}],
        queryFn: {{queryFn}},
      });

      {{CHILDREN}}

      return { data, error, isLoading, refetch };
    }
  >>>
`;

const REACT_MUTATION = `template name=mutation-hook
  slot name=hookName type=identifier
  slot name=mutationFn type=expr
  import from=@tanstack/react-query names=useMutation
  body <<<
    export function {{hookName}}() {
      const mutation = useMutation({
        mutationFn: {{mutationFn}},
        {{CHILDREN}}
      });

      return mutation;
    }
  >>>
`;

// ── tRPC ────────────────────────────────────────────────────────────────

const TRPC_QUERY = `template name=trpc-query
  slot name=hookName type=identifier
  slot name=route type=expr
  slot name=input type=expr optional=true
  body <<<
    export function {{hookName}}({{input}}) {
      const query = api.{{route}}.useQuery({{input}});

      {{CHILDREN}}

      return query;
    }
  >>>
`;

// ── XState ──────────────────────────────────────────────────────────────

const XSTATE_MACHINE = `template name=xstate-machine
  slot name=machineName type=identifier
  slot name=contextType type=identifier optional=true
  import from=xstate names="setup,assign"
  body <<<
    export const {{machineName}}Machine = setup({
      types: {
        context: {} as {{contextType}},
      },
      guards: {
        {{CHILDREN}}
      },
    }).createMachine({
      id: '{{machineName}}',
      context: ({input}) => input,
    });
  >>>
`;

// ── Jotai ───────────────────────────────────────────────────────────────

const JOTAI_ATOM = `template name=jotai-atom
  slot name=atomName type=identifier
  slot name=atomType type=type
  slot name=initialValue type=expr
  import from=jotai names=atom
  body <<<
    export const {{atomName}}Atom = atom<{{atomType}}>({{initialValue}});
  >>>
`;

const JOTAI_DERIVED = `template name=jotai-derived
  slot name=atomName type=identifier
  slot name=sourceAtom type=identifier
  import from=jotai names="atom,useAtomValue"
  body <<<
    export const {{atomName}}Atom = atom((get) => {
      const source = get({{sourceAtom}}Atom);
      {{CHILDREN}}
    });
  >>>
`;

// ── Arrow Function Export ───────────────────────────────────────────────

const ARROW_FN = `template name=arrow-fn
  slot name=name type=identifier
  slot name=params type=expr optional=true
  slot name=returnType type=type optional=true
  body <<<
    export const {{name}} = ({{params}}){{returnType}} => {
      {{CHILDREN}}
    };
  >>>
`;

// ── Window Event Hook ───────────────────────────────────────────────────

const WINDOW_EVENT = `template name=window-event
  slot name=hookName type=identifier
  slot name=eventName type=expr
  import from=react names="useEffect,useCallback"
  body <<<
    export function {{hookName}}() {
      const handleEvent = useCallback((e: Event) => {
        {{CHILDREN}}
      }, []);

      useEffect(() => {
        window.addEventListener({{eventName}}, handleEvent);
        return () => window.removeEventListener({{eventName}}, handleEvent);
      }, [handleEvent]);
    }
  >>>
`;

// ── Catalog ─────────────────────────────────────────────────────────────

export const TEMPLATE_CATALOG: CatalogEntry[] = [
  {
    packageName: 'zustand',
    libraryName: 'Zustand',
    templates: {
      'zustand-store.kern': ZUSTAND_STORE,
      'zustand-selector.kern': ZUSTAND_SELECTOR,
    },
  },
  {
    packageName: 'swr',
    libraryName: 'SWR',
    templates: {
      'swr-hook.kern': SWR_HOOK,
    },
  },
  {
    packageName: '@tanstack/react-query',
    libraryName: 'TanStack Query',
    templates: {
      'query-hook.kern': REACT_QUERY_HOOK,
      'mutation-hook.kern': REACT_MUTATION,
    },
  },
  {
    packageName: '@trpc/react-query',
    libraryName: 'tRPC',
    templates: {
      'trpc-query.kern': TRPC_QUERY,
    },
  },
  {
    packageName: 'xstate',
    libraryName: 'XState',
    templates: {
      'xstate-machine.kern': XSTATE_MACHINE,
    },
  },
  {
    packageName: 'jotai',
    libraryName: 'Jotai',
    templates: {
      'jotai-atom.kern': JOTAI_ATOM,
      'jotai-derived.kern': JOTAI_DERIVED,
    },
  },
];

/** Always-included templates (framework-agnostic patterns) */
export const COMMON_TEMPLATES: Record<string, string> = {
  'arrow-fn.kern': ARROW_FN,
  'window-event.kern': WINDOW_EVENT,
};

/**
 * Detect which catalog entries match a project's package.json.
 */
export function detectTemplates(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): CatalogEntry[] {
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  return TEMPLATE_CATALOG.filter((entry) => entry.packageName in allDeps);
}
