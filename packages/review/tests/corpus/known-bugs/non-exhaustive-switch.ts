// BUG: switch on union type missing the 'error' case — non-exhaustive
type Status = 'loading' | 'success' | 'error';

export function statusMessage(status: Status): string {
  switch (status) {
    case 'loading':
      return 'Please wait...';
    case 'success':
      return 'Done!';
    // missing 'error' case
  }
}
