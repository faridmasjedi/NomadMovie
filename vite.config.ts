import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // loaded lazily (AI selection); pre-bundle it up front so the dev server doesn't reload the page on first use
  optimizeDeps: { include: ["@huggingface/transformers"] },
  // the website demo recorder's footage and output (tools/demos) aren't part of the app
  server: { watch: { ignored: ["**/tools/demos/work/**"] } },
});
