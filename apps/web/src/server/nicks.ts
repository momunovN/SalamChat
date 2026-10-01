import { queryOne } from "./db";

export async function nickTaken(nick: string, except?: { userId?: string; chatId?: string }) {
  const userExcept = except?.userId ?? null;
  const chatExcept = except?.chatId ?? null;
  const user = await queryOne<{ id: string }>(
    `SELECT id FROM users
     WHERE lower(username)=lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [nick, userExcept],
  );
  if (user) return true;
  const chat = await queryOne<{ id: string }>(
    `SELECT id FROM chats
     WHERE username IS NOT NULL AND lower(username)=lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [nick, chatExcept],
  );
  if (chat) return true;
  const pub = await queryOne<{ id: string }>(
    `SELECT id FROM users
     WHERE public_id=$1 AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [nick, userExcept],
  );
  return !!pub;
}
