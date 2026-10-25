import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { mongoDb } from "../lib/mongo";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    const db = await mongoDb();
    await db.command({ ping: 1 });
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[redacted MongoDB URI]") : "Unknown MongoDB error";
    logger.error({ message }, "MongoDB health check failed");
    const data = HealthCheckResponse.parse({ status: "degraded" });
    res.status(503).json(data);
  }
});

export default router;
