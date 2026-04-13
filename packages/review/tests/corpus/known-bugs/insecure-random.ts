// BUG: Math.random() used for security token — not cryptographically secure
export function generateToken(): string {
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
}
