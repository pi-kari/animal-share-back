import express from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const port = Number(process.env.BACKEND_PORT);

async function main() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    cors({
      origin: process.env.FRONTEND_URL ?? "http://localhost:3000/",
      credentials: true,
    })
  );
  registerRoutes(app);

  app.listen(port, async () => {
    console.log(`Server is running on port ${port}`);
  });
}

main();
