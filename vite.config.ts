import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, mkdirSync } from "node:fs";
// Bundle every PDF.js decoder, font, CMap and icon locally. No CDN fallback.
for (const directory of ["cmaps", "standard_fonts", "wasm", "web/images"]) {
  mkdirSync(`public/pdfjs/${directory}`, { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${directory}`, `public/pdfjs/${directory}`, {
    recursive: true,
  });
}
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/services/platform.ts",
        "src-tauri/**",
        "**/*.d.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  server: {
    host: "localhost",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/public/pdfjs/**",
        "**/release/**",
        "**/engine/**",
        "**/tests/pdf-fixtures/**",
      ],
    },
  },
  build: { target: "es2022" },
});
