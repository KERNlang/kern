// BUG: hardcoded API key in source
const API_KEY = 'sk-live-abc123def456ghi789jkl012mno345';

export function getHeaders() {
  return { Authorization: `Bearer ${API_KEY}` };
}
