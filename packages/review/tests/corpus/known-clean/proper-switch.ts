// CLEAN: exhaustive switch with all cases and default — no missing branches
type Status = 'loading' | 'success' | 'error';

export function statusMessage(status: Status): string {
  switch (status) {
    case 'loading':
      return 'Please wait...';
    case 'success':
      return 'Done!';
    case 'error':
      return 'Something went wrong.';
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled status: ${_exhaustive}`);
    }
  }
}
