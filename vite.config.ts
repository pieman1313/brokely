import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Everything runs in the browser — there is no server component and no telemetry.
// Your statement is parsed locally and never uploaded anywhere.
//
// For GitHub Pages project sites the app is served from /<repo>/, so the build
// uses that base; local dev stays at /. Override with VITE_BASE if the repo name
// differs (e.g. `VITE_BASE=/my-fork/ npm run build`).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? process.env.VITE_BASE ?? "/spend/" : "/",
  server: { open: true },
}));
