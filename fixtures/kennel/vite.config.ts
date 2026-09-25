import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build serves every mode: bugs are switched at runtime via GET /api/__config.
export default defineConfig({
  plugins: [react()],
  // "hidden": source maps are written next to the bundle without a sourceMappingURL comment. The server only serves
  // them with S08 (public source maps); clean mode answers 404.
  build: { outDir: "dist", emptyOutDir: true, sourcemap: "hidden" },
});
