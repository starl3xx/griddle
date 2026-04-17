-- Start-gated timer: separate "page loaded" from "player pressed Start".
--
-- Until now, server_solve_ms = now - puzzle_loads.loaded_at, so login time,
-- cold-load latency, and shared-link preview all inflated solve time. The
-- Start gate (blurred grid + centered Start button) stamps started_at on
-- first click, and the solve route times from there instead.
--
-- loaded_at is preserved — it's still useful telemetry (the gap between
-- loaded_at and started_at is "idle pre-start" time per user).

ALTER TABLE "puzzle_loads"
  ADD COLUMN IF NOT EXISTS "started_at" timestamp;
