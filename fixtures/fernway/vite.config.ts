import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build serves every mode: bugs are switched at runtime via GET /api/__config.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // "hidden": source maps are written next to the bundle without a sourceMappingURL comment, and the server
  // answers 404 for every *.map (CONTRACT.md).
  build: { outDir: "dist", emptyOutDir: true, sourcemap: "hidden" },
});
