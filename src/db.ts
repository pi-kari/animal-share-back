// import { Pool, neonConfig } from "@neondatabase/serverless";
// import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "./schema";
import { Pool } from "pg";

require("dotenv").config({ path: ".env" });
// neonConfig.webSocketConstructor = ws;

export const pool = new Pool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASS,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_DB,
});
export const db = drizzle(pool, { schema });
