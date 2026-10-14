import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: process.env.VERCEL ? "../public" : "dist",
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/recharts/")) {
            return "charts";
          }
          if (id.includes("/node_modules/d3-")) return "d3";
        },
      },
    },
  },
  server: { port: 5173 },
});
