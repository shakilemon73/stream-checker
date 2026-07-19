---
name: StreamGuard Orval codegen collision fix
description: Orval generates both Zod schemas and TS types with the same *Params names, causing TS2308 when both are re-exported from api-zod/src/index.ts
---

## The Rule
After running `orval --config ./orval.config.ts`, always overwrite `lib/api-zod/src/index.ts` with a selective export file. Never let Orval's auto-generated barrel be the package's public API.

## Why
Orval generates `GetPlaylistChannelsParams`, `GetJobResultsParams`, `ExportJobParams` as both Zod schemas (values, in `generated/api.ts`) and TypeScript interfaces (types, in `generated/types/*.ts`). Re-exporting both with `export *` causes TS2308 duplicate identifier errors. Orval also appends its own `export *` lines to whatever barrel file it finds, undoing manual fixes.

## How to Apply
1. Run `pnpm exec orval --config ./orval.config.ts` (just orval, not the full codegen script)
2. Immediately overwrite `lib/api-zod/src/index.ts` with:
   - `export * from "./generated/api"` (the Zod schemas)
   - `export type { X } from "./generated/types/X"` for each non-colliding type (use `export type`, not `export`, for isolatedModules compatibility)
   - Omit the `*Params` names entirely from the types re-exports — those names already exist as Zod schemas from the api export
3. Run `pnpm run typecheck:libs` to verify

The colliding names (as of current spec): `GetPlaylistChannelsParams`, `GetJobResultsParams`, `ExportJobParams`
