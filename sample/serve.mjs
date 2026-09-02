// 撮影用の標本を配るだけの口。file:// だと拡張が流し込めないので http で出す。
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const ROOT = new URL(".", import.meta.url).pathname.replace(/^\//, "");
createServer((req, res) => {
  const name = (req.url || "/").split("?")[0].replace(/^\//, "") || "index.html";
  // 読めてからヘッダを書く。逆にすると、無いファイルの 404 でヘッダ二重送信になって落ちる。
  let body;
  try {
    body = readFileSync(ROOT + name);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}).listen(3500, "127.0.0.1", () => console.log("http://localhost:3500/"));
