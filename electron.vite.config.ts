import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Keep Mastra (and its native-ish deps: execa, ws, posthog) out of the
        // bundle so Node resolves them from node_modules at runtime.
        external: ["electron", /^@mastra\//],
        input: {
          index: resolve(__dirname, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(__dirname, "src/preload/index.ts")
        }
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          overlay: resolve(__dirname, "overlay.html")
        }
      }
    }
  }
});
