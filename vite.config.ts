import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/target/**"] }
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        main: "index.html",
        capture: "capture.html",
      },
    },
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
