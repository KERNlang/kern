// CLEAN: parameterized SQL query — no interpolation of user input
import type { Pool } from 'pg';

export async function getUser(pool: Pool, userId: string) {
  const result = await pool.query(
    'SELECT id, name, email FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0];
}
