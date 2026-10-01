ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id TEXT;

ALTER TABLE chats ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS chats_username_lower_uidx ON chats (lower(username)) WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION salam_public_id() RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  out text := '';
  i int;
  n int;
BEGIN
  n := length(alphabet);
  FOR i IN 1..8 LOOP
    out := out || substr(alphabet, 1 + floor(random() * n)::int, 1);
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION users_set_public_id() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  tries int := 0;
BEGIN
  IF NEW.public_id IS NOT NULL AND NEW.public_id <> '' THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := salam_public_id();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM users WHERE public_id = candidate OR lower(coalesce(username, '')) = candidate
    ) AND NOT EXISTS (
      SELECT 1 FROM chats WHERE lower(coalesce(username, '')) = candidate
    );
    tries := tries + 1;
    IF tries > 40 THEN
      RAISE EXCEPTION 'public_id exhausted';
    END IF;
  END LOOP;
  NEW.public_id := candidate;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS users_public_id ON users;
  CREATE TRIGGER users_public_id
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_set_public_id();
END $$;

DO $$
DECLARE
  r record;
  candidate text;
  tries int;
BEGIN
  FOR r IN SELECT id FROM users WHERE public_id IS NULL OR public_id = '' LOOP
    tries := 0;
    LOOP
      candidate := salam_public_id();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM users WHERE public_id = candidate OR lower(coalesce(username, '')) = candidate
      ) AND NOT EXISTS (
        SELECT 1 FROM chats WHERE lower(coalesce(username, '')) = candidate
      );
      tries := tries + 1;
      IF tries > 40 THEN
        RAISE EXCEPTION 'public_id exhausted';
      END IF;
    END LOOP;
    UPDATE users SET public_id = candidate WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_uidx ON users (public_id);
ALTER TABLE users ALTER COLUMN public_id SET NOT NULL;
