// BUG: identical condition in if/else-if — second branch is dead code
export function classify(score: number): string {
  if (score > 90) {
    return 'excellent';
  } else if (score > 90) {
    return 'great'; // unreachable — same condition as above
  } else {
    return 'ok';
  }
}
