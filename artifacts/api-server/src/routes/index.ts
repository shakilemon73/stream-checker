import { Router } from "express";
import healthRouter from "./health.js";
import playlistsRouter from "./playlists.js";
import jobsRouter from "./jobs.js";
import resultsRouter from "./results.js";
import settingsRouter from "./settings.js";
import { streamProxy } from "./stream-proxy.js";

const router = Router();

router.use(healthRouter);
router.use(playlistsRouter);
router.use(jobsRouter);
router.use(resultsRouter);
router.use(settingsRouter);
router.get("/stream-proxy", streamProxy);

export default router;
