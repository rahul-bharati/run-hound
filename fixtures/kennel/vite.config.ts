import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build serves every mode: bugs are switched at runtime via GET /api/__config.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
