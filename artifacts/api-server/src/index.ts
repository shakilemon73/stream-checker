import { createServer } from "http";
import app from "./app.js";
import { createSocketServer } from "./lib/socket-server.js";
import { logger } from "./lib/logger.js";
import { initDb } from "@workspace/db";

const rawPort = process.env["PORT"] || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
createSocketServer(httpServer);

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error({ port }, `Port ${port} is already in use. Exiting process so supervisor can restart cleanly.`);
    process.exit(1);
  } else {
    logger.error({ err }, "Server error encountered");
    process.exit(1);
  }
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Received shutdown signal, closing server...");
  httpServer.close(() => {
    logger.info("HTTP server closed.");
    process.exit(0);
  });
  // Force exit after 5s if connections linger
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  try {
    await initDb();
    logger.info("Database initialized successfully");
  } catch (err) {
    logger.error({ err }, "Database initialization warning (will retry on query)");
  }

  httpServer.listen(port, "0.0.0.0", () => {
    logger.info({ port }, `StreamGuard server is active and listening on port ${port}`);
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start StreamGuard server");
  process.exit(1);
});
