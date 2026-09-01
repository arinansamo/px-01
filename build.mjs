/*
 * dist/ を作る。esbuild で2本束ねて、manifest を写すだけ。
 * measure は content script として流し込むので iife（ES モジュールは content script で使えない）、
 * background は service worker なので esm。
 *
 * ここだけ素の JavaScript にしてあるのは、入口は動く環境をできるだけ狭めないため
 * ——`.ts` にすると Node 22.6 未満では最初の一手で止まり、原因が分かりにくい。
 *
 * --watch のときは、焼いた時刻を配る小さなサーバーも立てる。常駐がそれを見張り、
 * 変わったら自分で拡張を入れ替える——chrome://extensions の再読み込みを押さずに済ませるため。
 */
import { createServer } from "node:http";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** 見張りが焼き直しに気づくための番地。 */
const STAMP_PORT = 3401;

let build = new Date().toISOString();

const TARGETS = [
  { entry: "src/measure.ts", outfile: "dist/measure.js", format: "iife" },
  { entry: "src/background.ts", outfile: "dist/background.js", format: "esm" },
];

mkdirSync("dist", { recursive: true });

const options = (entry, outfile, format) => ({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format,
  target: "chrome120",
  define: { __PX01_BUILD__: JSON.stringify(build), __PX01_DEV__: JSON.stringify(watch) },
  logLevel: "info",
});

if (watch) {
  // 変わるたびに刻印を打ち直したいので、esbuild の watch ではなく毎回焼き直す形にする。
  const { watch: fsWatch } = await import("node:fs");
  const rebuild = async () => {
    build = new Date().toISOString();
    for (const t of TARGETS) await esbuild.build(options(t.entry, t.outfile, t.format));
    writeFileSync("dist/build.txt", build);
    copyFileSync("manifest.json", "dist/manifest.json");
    console.log(`焼き直しました ${build}`);
  };
  await rebuild();
  createServer((_, res) => {
    res.writeHead(200, {
      "content-type": "text/plain",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(build);
  }).listen(STAMP_PORT, "127.0.0.1", () => console.log(`刻印を ${STAMP_PORT} で配っています`));
  let pending = null;
  fsWatch("src", { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(rebuild, 120);
  });
  console.log("見張っています（Ctrl-C で終わり）");
} else {
  for (const t of TARGETS) await esbuild.build(options(t.entry, t.outfile, t.format));
  copyFileSync("manifest.json", "dist/manifest.json");
  console.log("できました: dist/");
}
