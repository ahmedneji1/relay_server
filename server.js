const { WebSocketServer } = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (req.url === "/" || req.url === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end("error loading UI"); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

let esp32 = null;          // the one ESP32 connection
const browsers = new Set(); // all browser clients

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const br of browsers) {
    if (br.readyState === 1) br.send(msg);
  }
}

wss.on("connection", (ws) => {
  let role = "unknown";

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // ── Identification handshake ──────────────────────
    if (data.type === "identify") {
      role = data.role;

      if (role === "esp32") {
        esp32 = ws;
        console.log("[relay] ESP32 connected");
        broadcast({ type: "esp32_status", online: true });

        ws.on("close", () => {
          console.log("[relay] ESP32 disconnected");
          esp32 = null;
          broadcast({ type: "esp32_status", online: false });
        });

      } else if (role === "browser") {
        browsers.add(ws);
        console.log(`[relay] Browser connected (total: ${browsers.size})`);
        // Tell browser current ESP32 status
        ws.send(JSON.stringify({ type: "esp32_status", online: !!esp32 }));

        ws.on("close", () => {
          browsers.delete(ws);
          console.log(`[relay] Browser disconnected (total: ${browsers.size})`);
        });
      }
      return;
    }

    // ── Browser → ESP32 commands ──────────────────────
    if (role === "browser") {
      if (!esp32 || esp32.readyState !== 1) {
        ws.send(JSON.stringify({ type: "error", msg: "ESP32 offline" }));
        return;
      }
      // Forward command straight to ESP32
      esp32.send(JSON.stringify(data));
      return;
    }

    // ── ESP32 → browsers (acks, status) ──────────────
    if (role === "esp32") {
      broadcast(data);
    }
  });

  ws.on("error", (e) => console.error("[relay] WS error:", e.message));
});

server.listen(PORT, () => {
  console.log(`[relay] Running on port ${PORT}`);
});
