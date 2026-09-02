import { defineConfig } from "drizzle-kit";

const defaultDatabaseUrl = "postgres://postgres:postgres@localhost:5432/ank1015_app";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
