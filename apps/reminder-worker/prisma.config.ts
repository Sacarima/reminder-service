import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // your schema is at repo root: prisma/schema.prisma
  schema: path.join("..", "..", "prisma", "schema.prisma"),
  // optional but handy so migrate/studio know where migrations live
  migrations: { path: path.join("..", "..", "prisma", "migrations") },
});
