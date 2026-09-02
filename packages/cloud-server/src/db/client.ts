import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

export const createDbClient = (databaseUrl: string) => {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql, { schema });

  return {
    db,
    close: () => sql.end(),
  };
};

export type DbClient = ReturnType<typeof createDbClient>["db"];
