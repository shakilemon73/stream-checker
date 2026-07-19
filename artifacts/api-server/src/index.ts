import { createServer } from "http";
import app from "./app.js";
import { createSocketServer } from "./lib/socket-server.js";
import { logger } from "./lib/logger.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
createSocketServer(httpServer);

httpServer.listen(port, () => {
  logger.info({ port }, "StreamGuard API server listening");
});
