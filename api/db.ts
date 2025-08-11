import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

export const client = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client, schema });
