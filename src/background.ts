/*
 * 常駐側。やることは2つだけ——アイコンかショートカットで measure.js を流し込むことと、
 * 開発中（pnpm watch）に焼き直しを見張って、自分で拡張を入れ替えること。
 */

/** ビルドの刻印。build.mjs が焼き込む。 */
declare const __PX01_BUILD__: string;

/** pnpm watch で焼いたか。製品のビルドでは false になり、見張りは動かない。 */
declare const __PX01_DEV__: boolean;

/** 焼き直しの刻印を配っている番地（pnpm watch が立てる）。 */
const STAMP = "http://127.0.0.1:3401/";

/** 焼き直しを確かめる間隔（ミリ秒）。 */
const CHECK_MS = 1500;

/**
 * 対象のタブへ計測の中身を流し込む。
 * 静的な content_scripts にしないのは、押されるまでどのページにも一切触れないため。
 * @param tabId 流し込む先のタブ
 */
const inject = async (tabId: number): Promise<void> => {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["measure.js"] });
};

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void inject(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) void inject(tab.id);
});

// 焼き直しの見張り。刻印が変わったら自分を入れ替える——手で再読み込みを押さずに済む。
// サーバーが立っていなければ黙って何もしない（普段使いでは毎回ここで失敗して終わる）。
if (__PX01_DEV__) {
  setInterval(async () => {
    try {
      const latest = (await (await fetch(STAMP, { cache: "no-store" })).text()).trim();
      if (latest && latest !== __PX01_BUILD__) chrome.runtime.reload();
    } catch {
      // watch が動いていないだけ。
    }
  }, CHECK_MS);
}
