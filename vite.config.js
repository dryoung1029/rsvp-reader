import { defineConfig } from "vite";

// `npm run dev` serves the frontend with hot reload and forwards /api to a
// local Worker started with `npx wrangler dev` (port 8787).
export default defineConfig({
  server: {
    proxy: { "/api": "http://localhost:8787" }
  }
});
