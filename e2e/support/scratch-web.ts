import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** EPIC-P39: Scratch-Webapp auf Loopback für die Browser-Specs (echtes Chromium, kein Mock). */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Scratch</title>
<style>body{margin:0;font-family:sans-serif}#b{position:absolute;left:20px;top:20px;width:240px;height:70px;font-size:20px}
#t{position:absolute;left:20px;top:120px;font-size:30px;color:rgb(0,0,255)}#pw{position:absolute;left:20px;top:200px;width:240px;height:36px}
#name{position:absolute;left:20px;top:260px;width:240px;height:36px}</style>
<h1 id="t">Hallo Scratch</h1>
<button id="b" onclick="window.n=(window.n||0)+1;this.textContent='Klicks: '+window.n;document.title='Klicks: '+window.n">Klicks: 0</button>
<input id="pw" type="password" aria-label="Passwort"><input id="name" aria-label="Name" oninput="document.title='Name: '+this.value">
<script>fetch('http://example.invalid/leak').catch(()=>{})</script>`;

export async function startScratch(): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.url === "/cookie-set") { res.writeHead(200, { "content-type": "text/html", "set-cookie": "sess=geheim; Path=/" }); res.end("<p>gesetzt</p>"); return; }
    if (req.url === "/cookie-read") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<p id="c">${req.headers.cookie ?? "leer"}</p>`); return; }
    if (req.url === "/langsam") { res.writeHead(200, { "content-type": "text/html" }); res.end("<p>lädt</p>"); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
