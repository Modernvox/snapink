import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  cacheDir: path.resolve(__dirname, ".vite-cache"),
  server: {
    fs: {
      deny: ["**/functions/private-assets/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        admin: path.resolve(__dirname, "admin.html"),
        customize: path.resolve(__dirname, "customize.html"), 
        fitGuide: path.resolve(__dirname, "fit-guide.html"),
        pilot: path.resolve(__dirname, "pilot.html"),
        press: path.resolve(__dirname, "press.html"),
        drop001: path.resolve(__dirname, "drop001.html"),
        wholesaleInfo: path.resolve(__dirname, "wholesale-info.html"),
        contact: path.resolve(__dirname, "contact.html"),
        partnerPortal: path.resolve(__dirname, "partner-portal.html"),
        wholesale: path.resolve(__dirname, "wholesale.html"),
        wholesaleStudio: path.resolve(__dirname, "wholesale-studio.html")
      },
    },
  },
});
