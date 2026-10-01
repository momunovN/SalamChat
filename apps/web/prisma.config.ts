import { existsSync } from "fs";
import path from "path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

let dir = process.cwd();
for (let i = 0; i < 6; i++) {
  const p = path.join(dir, ".env");
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const url =
  process.env.DATABASE_URL ||
  process.env.SALAM_DATABASE_URL ||
  process.env.TOOAPP_DATABASE_URL ||
  process.env.SAMAL_DATABASE_URL ||
  "postgres://salam:salam@localhost:5432/salam?sslmode=disable";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});
