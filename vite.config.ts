import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { randomBytes, timingSafeEqual } from "node:crypto";
const require = createRequire(import.meta.url);
const { EngineBridge } = require("./electron/bridge.cjs");
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "local-pdf-engine",
      configureServer(server) {
        const engine = new EngineBridge(process.cwd());
        const token = randomBytes(32).toString("hex");
        server.httpServer?.on("close", () => engine.close());
        server.middlewares.use("/api", async (req, res) => {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "application/json");
          const host = req.headers.host || "";
          const origin = req.headers.origin;
          if (
            !/^127\.0\.0\.1:\d+$/.test(host) ||
            (origin && origin !== `http://${host}`) ||
            req.headers["sec-fetch-site"] === "cross-site"
          ) {
            res.statusCode = 403;
            res.end("{}");
            return;
          }
          if (req.url === "/session" && req.method === "GET") {
            res.end(JSON.stringify({ token }));
            return;
          }
          const provided = Buffer.from(
            String(req.headers["x-navpdf-token"] || ""),
          );
          if (
            provided.length !== token.length ||
            !timingSafeEqual(provided, Buffer.from(token)) ||
            req.method !== "POST" ||
            req.url !== "/pdf"
          ) {
            res.statusCode = 403;
            res.end("{}");
            return;
          }
          try {
            const chunks: Buffer[] = [];
            let length = 0;
            for await (const chunk of req) {
              length += chunk.length;
              if (length > 145 * 1024 * 1024)
                throw new Error("File is too large.");
              chunks.push(chunk);
            }
            res.end(
              JSON.stringify({
                result: await engine.call(
                  JSON.parse(Buffer.concat(chunks).toString()),
                ),
              }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error:
                  error instanceof Error ? error.message : "Operation failed.",
              }),
            );
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
