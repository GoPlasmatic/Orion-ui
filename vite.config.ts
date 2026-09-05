import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const orionTarget = process.env.ORION_URL ?? "http://localhost:8080"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Rolldown (Vite 8) replaced the `manualChunks` object form with named
        // groups. React keeps the highest priority so it stays in react-vendor
        // rather than being pulled into a consumer's chunk as a dependency.
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|react-router)[\\/]/,
              priority: 3,
            },
            { name: "react-flow", test: /node_modules[\\/]@xyflow[\\/]/, priority: 2 },
            // Reached only through the lazy `json-editor.tsx`, so this chunk is
            // fetched the first time an editor mounts, not on the dashboard.
            {
              name: "codemirror",
              test: /node_modules[\\/](@codemirror|@lezer|codemirror|style-mod|w3c-keyname|crelt)[\\/]/,
              priority: 2,
            },
            { name: "tanstack", test: /node_modules[\\/]@tanstack[\\/]/, priority: 1 },
          ],
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
