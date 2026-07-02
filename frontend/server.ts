import express from "express";
import path from "path";
import http from "http";
import fs from "fs";
import { execFile } from "child_process";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Proxy /api/* requests to FastAPI backend running on port 8000
app.use("/api", (req, res) => {
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: 8000,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: "127.0.0.1:8000",
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    console.error(`Proxy error connecting to 127.0.0.1:8000${req.url}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "FastAPI Backend service unavailable on port 8000." });
    }
  });

  req.pipe(proxyReq, { end: true });
});

// --- Vite Middleware Integration & Static Assets ---
async function startServer() {
  const PORT = 3000;

  // Integrate Vite dev server or serve production dist
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
