import express from "express";
import cors from "cors";
import { registerRoutes } from "./routes";

require("dotenv").config({ path: ".env" });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);
registerRoutes(app);

export default app;
