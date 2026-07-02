import express from "express";
import path from "path";
import http from "http";
import fs from "fs";
import { execFile } from "child_process";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Serve actual candidate PDF file directly from storage
app.get("/api/candidates/:id/raw-file", (req, res) => {
  const candId = req.params.id;
  const dbPath = path.resolve(process.cwd(), "../Backend/recruitment_platform.db");
  const script = `
import sqlite3, sys
conn = sqlite3.connect('${dbPath.replace(/\\/g, "/")}')
c = conn.cursor()
c.execute('SELECT raw_file_storage_path, original_filename FROM candidates WHERE id=?', (int(sys.argv[1]),))
row = c.fetchone()
if row:
    print(row[0] + "|||" + row[1])
`;

  execFile("python", ["-c", script, candId], (error, stdout) => {
    if (error || !stdout.trim()) {
      return res.status(404).send("File not found");
    }
    const [filePath, origName] = stdout.trim().split("|||");
    if (filePath && fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${origName || "resume.pdf"}"`);
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.status(404).send("Raw PDF file missing on disk");
    }
  });
});

// Update job status in database
app.patch("/api/jobs/:id/status", express.json(), (req, res) => {
  const jobId = req.params.id;
  const { status } = req.body;
  const dbPath = path.resolve(process.cwd(), "../Backend/recruitment_platform.db");
  const script = `
import sqlite3, sys
conn = sqlite3.connect('${dbPath.replace(/\\/g, "/")}')
c = conn.cursor()
c.execute('UPDATE jobs SET status=UPPER(?) WHERE id=?', (sys.argv[2], int(sys.argv[1])))
conn.commit()
print(c.rowcount)
`;
  execFile("python", ["-c", script, jobId, status], (error, stdout) => {
    if (error || !stdout.trim() || stdout.trim() === "0") {
      return res.status(500).json({ error: "Failed to update status in database" });
    }
    res.json({ success: true, id: jobId, status: String(status).toUpperCase() });
  });
});

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
