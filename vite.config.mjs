import { defineConfig } from "vite";
export default defineConfig({
  root: "client",
  build: { outDir: "../dist", emptyOutDir: true },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:3000" } },
});
