import express from "express";
import { AddressInfo } from "net";
import { Server } from "http";
import path from "path";

export function startTestServer(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const app = express();
    // Serve the public directory
    app.use(express.static(path.resolve(__dirname, "../public"))); 
    
    // Test endpoint that sends strict CSP headers
    app.get("/csp-strict", (req, res) => {
      res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'");
      res.sendFile(path.resolve(__dirname, "../public/index.html"));
    });
    
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}
