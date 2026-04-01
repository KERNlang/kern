// BUG: direct mutation of state via push() instead of immutable update
interface AppState {
  items: string[];
}

export function addItem(state: AppState, item: string): AppState {
  state.items.push(item); // mutates existing array
  return state;
}
