import { defineConfig, type ProxyOptions } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const orionTarget = process.env.ORION_URL ?? "http://localhost:8080"

/**
 * `ORION_ADMIN_AUTHORIZATION` (the whole header value, `Bearer <key>`) is
 * added to proxied requests that carry no `Authorization` of their own — the
 * same rule as the image's nginx, so a dev server against a guarded Orion
 * needs no key typed in. Unset, the console asks for one.
 */
const injectedAuthorization = process.env.ORION_ADMIN_AUTHORIZATION || undefined

const proxyTo = (target: string): ProxyOptions => ({
  target,
  changeOrigin: true,
  configure: (proxy) => {
    if (!injectedAuthorization) return
    proxy.on("proxyReq", (proxyReq, req) => {
      // Never the data plane: a channel sees only what its caller sent.
      if (req.url?.startsWith("/api/v2/data/")) return
      if (!req.headers.authorization) proxyReq.setHeader("Authorization", injectedAuthorization)
    })
  },
})

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
      "/api": proxyTo(orionTarget),
      "/health": proxyTo(orionTarget),
      "/healthz": proxyTo(orionTarget),
      "/readyz": proxyTo(orionTarget),
      "/metrics": proxyTo(orionTarget),
    },
  },
})
