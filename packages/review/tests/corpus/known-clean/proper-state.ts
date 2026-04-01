// CLEAN: immutable state update using spread — no direct mutation
interface AppState {
  items: string[];
  count: number;
}

export function addItem(state: AppState, item: string): AppState {
  return {
    ...state,
    items: [...state.items, item],
    count: state.count + 1,
  };
}
