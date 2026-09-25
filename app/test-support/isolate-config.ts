/**
 * Vitest setup: every test worker gets its own empty Run Hound config folder and no RUNHOUND_AI_* variables, so no
 * test reads or writes the developer's real ~/.config/run-hound/ai.json (which would turn AI on for unrelated tests),
 * and a test that restores the environment afterwards falls back to this folder, never to the real one. CLI tests
 * inherit it through the environment of the processes they spawn.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rh-test-config-"));
process.env.RUNHOUND_CONFIG_DIR = dir;
process.env.XDG_CONFIG_HOME = dir;
for (const key of Object.keys(process.env)) if (key.startsWith("RUNHOUND_AI")) delete process.env[key];
