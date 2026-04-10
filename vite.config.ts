import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

const orionTarget = process.env.ORION_URL ?? "http://localhost:8080"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router"],
          "react-flow": ["@xyflow/react"],
          "tanstack": ["@tanstack/react-query", "@tanstack/react-table"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: orionTarget,
        changeOrigin: true,
      },
      "/health": {
        target: orionTarget,
        changeOrigin: true,
      },
      "/healthz": {
        target: orionTarget,
        changeOrigin: true,
      },
      "/readyz": {
        target: orionTarget,
        changeOrigin: true,
      },
      "/metrics": {
        target: orionTarget,
        changeOrigin: true,
      },
    },
  },
})
