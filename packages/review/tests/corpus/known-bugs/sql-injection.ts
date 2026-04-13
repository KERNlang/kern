// BUG: raw SQL query with user input interpolation — SQL injection
export async function getUser(req: Request, res: Response) {
  const userId = req.params.id;
  const query = `SELECT * FROM users WHERE id = '${userId}'`;
  const result = await db.query(query);
  res.json(result);
}
