import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { defineConfig } from 'vite';

function rawPdfPlugin() {
  return {
    name: 'raw-pdf-middleware',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const match = req.url?.match(/^\/api\/candidates\/(\d+)\/raw-file/);
        if (match) {
          const candId = match[1];
          const dbPath = path.resolve(__dirname, '../Backend/recruitment_platform.db');
          const script = `
import sqlite3, sys
conn = sqlite3.connect('${dbPath.replace(/\\/g, '/')}')
c = conn.cursor()
c.execute('SELECT raw_file_storage_path, original_filename FROM candidates WHERE id=?', (int(sys.argv[1]),))
row = c.fetchone()
if row:
    print(row[0] + "|||" + row[1])
`;
          execFile('python', ['-c', script, candId], (error, stdout) => {
            if (error || !stdout.trim()) {
              res.statusCode = 404;
              return res.end('File not found');
            }
            const [filePath, origName] = stdout.trim().split('|||');
            if (filePath && fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `inline; filename="${origName || 'resume.pdf'}"`);
              fs.createReadStream(filePath).pipe(res);
            } else {
              res.statusCode = 404;
              res.end('Raw PDF file missing on disk');
            }
          });
          return;
        }
        const patchMatch = req.url?.match(/^\/api\/jobs\/(\d+)\/status/);
        if (patchMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
          const jobId = patchMatch[1];
          let body = '';
          req.on('data', (chunk: any) => { body += chunk; });
          req.on('end', () => {
            try {
              const { status } = JSON.parse(body);
              const dbPath = path.resolve(__dirname, '../Backend/recruitment_platform.db');
              const script = `
import sqlite3, sys
conn = sqlite3.connect('${dbPath.replace(/\\/g, '/')}')
c = conn.cursor()
c.execute('UPDATE jobs SET status=UPPER(?) WHERE id=?', (sys.argv[2], int(sys.argv[1])))
conn.commit()
print(c.rowcount)
`;
              execFile('python', ['-c', script, jobId, status], (error, stdout) => {
                res.setHeader('Content-Type', 'application/json');
                if (error || !stdout.trim() || stdout.trim() === '0') {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Failed to update job status' }));
                } else {
                  res.end(JSON.stringify({ success: true, id: jobId, status: String(status).toUpperCase() }));
                }
              });
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid body' }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), rawPdfPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
