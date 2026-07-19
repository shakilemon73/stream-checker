import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "./logger.js";

let io: SocketIOServer | null = null;

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*" },
    transports: ["polling", "websocket"],
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket client connected");

    socket.on("subscribe", ({ jobId }: { jobId: number }) => {
      const room = `job:${jobId}`;
      socket.join(room);
      logger.info({ socketId: socket.id, jobId }, "Socket subscribed to job");
    });

    socket.on("unsubscribe", ({ jobId }: { jobId: number }) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Socket client disconnected");
    });
  });

  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function emitJobProgress(
  jobId: number,
  data: {
    checked: number;
    live: number;
    dead: number;
    geoblocked: number;
    suspicious: number;
    pending: number;
    etaSeconds: number | null;
    avgCheckMs: number | null;
  }
): void {
  if (!io) return;
  io.to(`job:${jobId}`).emit("job:progress", { jobId, ...data });
}

export function emitJobResult(jobId: number, result: unknown): void {
  if (!io) return;
  io.to(`job:${jobId}`).emit("job:result", { jobId, result });
}

export function emitJobStatus(jobId: number, status: string): void {
  if (!io) return;
  io.to(`job:${jobId}`).emit("job:status", { jobId, status });
}
