/*
 * 触れている要素の余白と寸法と色を、帯を重ねて見せる。
 *
 * 鉄則: ページの既存ノードには何も書き込まない（属性も class も style も）。
 * 描くものは自前のホスト1枚に閉じ、Shadow DOM の中だけで完結させる。
 * ColorZilla の類いが body へ属性を足して Next の hydration を壊した事故を踏まないため。
 */

/** ビルドの刻印。build.ts が焼き込む（同じ版かどうかの見分けに使う）。 */
declare const __PX01_BUILD__: string;

/** pnpm watch で焼いたか。製品のビルドでは false。 */
declare const __PX01_DEV__: boolean;

type Px01 = { build: string; toggle: () => void };

declare global {
  interface Window {
    __px01?: Px01;
  }
}

const HOST_ID = "px-01-host";
// 暗い画面に映えるネオン。色相を四方に散らし、隣り合っても取り違えないようにする。
const PAD = "#00e5ff";
const GAP = "#9dff00";
const MARGIN = "#ffb300";
const EDGE = "#c86bff";

/**
 * 数値を px と rem の併記にする。
 * @param px ピクセル値
 * @param root ルートの文字サイズ（px）
 * @returns `32px (2rem)` の形。0 のときは `0`
 */
const withRem = (px: number, root: number): string => {
  if (px === 0) return "0";
  const rem = px / root;
  const r = Math.abs(rem - Math.round(rem)) < 0.001 ? String(Math.round(rem)) : rem.toFixed(3);
  return `${Math.round(px * 10) / 10}px (${r}rem)`;
};

/** sRGB の 1成分を線形へ戻す。 */
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * sRGB を OKLCH へ変換する（Björn Ottosson の行列）。
 * 若様のトークンが oklch で組まれているので、hex と並べて出す。
 * @param r 0-255
 * @param g 0-255
 * @param b 0-255
 * @returns `oklch(62% 0.21 29)` の形
 */
const toOklch = (r: number, g: number, b: number): string => {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return `oklch(${Math.round(L * 100)}% ${c.toFixed(3)} ${Math.round(h < 0 ? h + 360 : h)})`;
};

/**
 * 計算後の色文字列を hex と oklch の併記にする。
 * 解釈できない形（color() 等）はそのまま返す——嘘を書くより素の値を出す。
 * @param value getComputedStyle が返した色
 * @returns 表示用の文字列。透明なら null
 */
const readColor = (value: string): string | null => {
  const m = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return value === "none" ? null : value;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (alpha === 0) return null;
  const hex = `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  return `${hex}${alpha < 1 ? ` / ${alpha}` : ""}  ${toOklch(r, g, b)}`;
};

/** 帯1本ぶんの指示。 */
type Band = { x: number; y: number; w: number; h: number; color: string; label: string };


/** 札を左端に寄せてよい帯の幅。これより細いと札がはみ出すので、中央に跨がせる。 */
const LABEL_ROOM = 160;

/** 中の隙間を敷く上限。桝の多い grid で画面が帯だらけになるのを防ぐ。 */
const INNER_MAX = 24;

/**
 * 指やカーソルの居場所を知らせてくる催し。どれが届くかは環境で変わる
 * ——デバイス表示（タッチの真似）では pointer 系が抑えられることがあるので、mouse も併せて聞く。
 * 同じ動きで二度呼ばれても、描き直しは1フレームに1回に畳まれるので害はない。
 */
const MOVE_EVENTS = ["pointermove", "pointerdown", "mousemove"] as const;

/** 立ち上げている間、こちらが受け持つ打鍵。ページにも入力欄にも渡さない。 */
const OWNED_KEYS = new Set(["escape", "arrowup", "arrowdown", "c"]);

/**
 * この打鍵を受け取るか。
 * 修飾つき（Ctrl+C の複写など）と変換の最中は見送る——道具の都合でブラウザの手癖と日本語入力まで奪わない。
 * @param e 打鍵
 * @returns 受け取るなら true
 */
const owns = (e: KeyboardEvent): boolean =>
  !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && OWNED_KEYS.has(e.key.toLowerCase());

/** 測るための1枠。矩形と計算後スタイルを対にして持つ。 */
type Slot = { rect: DOMRect; style: CSSStyleDeclaration };

/**
 * 要素を1枠にする。
 * @param el 対象
 * @returns 矩形と計算後スタイルの対
 */
const slotOf = (el: Element): Slot => ({
  rect: el.getBoundingClientRect(),
  style: getComputedStyle(el),
});

/**
 * 隣り合う2つの間に実際に空いている距離を1本の帯にする。
 * gap の値を読むのではなく矩形の間を測るのは、margin や space-between で空いた距離も
 * 目には同じ隙間として見えているため——読む側は原因ではなく空きを見ている。
 * 兄弟との間も、箱の中の子同士も、この1つを通す（札の文言が場所によって食い違わないように）。
 * @param a 先にあるほう
 * @param b 後にあるほう
 * @param rowGap 並べる側の行の gap
 * @param colGap 並べる側の列の gap
 * @param collapse 縦の margin が相殺するか（block なら true、flex/grid なら false）
 * @param root ルートの文字サイズ
 * @returns 帯。隣り合っていない・重なっている・空きが無いなら null
 */
const between = (
  a: Slot,
  b: Slot,
  rowGap: number,
  colGap: number,
  collapse: boolean,
  root: number,
): Band | null => {
  const vertical = b.rect.top >= a.rect.bottom - 0.5;
  const horizontal = !vertical && b.rect.left >= a.rect.right - 0.5;
  if (!vertical && !horizontal) return null;
  const size = vertical ? b.rect.top - a.rect.bottom : b.rect.left - a.rect.right;
  if (size < 0.5) return null;
  const label = withRem(size, root);
  if (vertical) {
    const left = Math.min(a.rect.left, b.rect.left);
    return { x: left, y: a.rect.bottom, w: Math.max(a.rect.right, b.rect.right) - left, h: size, color: GAP, label };
  }
  const top = Math.min(a.rect.top, b.rect.top);
  return { x: a.rect.right, y: top, w: size, h: Math.max(a.rect.bottom, b.rect.bottom) - top, color: GAP, label };
};

/** 並べる側（親か自分）が配る gap と、縦 margin が相殺するかどうか。 */
const layoutOf = (el: Element): { rowGap: number; colGap: number; collapse: boolean } => {
  const cs = getComputedStyle(el);
  const flexish = /flex|grid/.test(cs.display);
  return {
    rowGap: flexish ? parseFloat(cs.rowGap) || 0 : 0,
    colGap: flexish ? parseFloat(cs.columnGap) || 0 : 0,
    collapse: !flexish,
  };
};

/**
 * この要素と、その前後の兄弟との間に空いている距離を帯にする。
 * @param el 対象の要素
 * @param root ルートの文字サイズ
 * @returns 帯の配列
 */
const siblingBands = (el: Element, root: number): Band[] => {
  const parent = el.parentElement;
  if (!parent) return [];
  const { rowGap, colGap, collapse } = layoutOf(parent);
  const me = slotOf(el);
  const out: Band[] = [];
  const prev = el.previousElementSibling;
  const next = el.nextElementSibling;
  const before = prev ? between(slotOf(prev), me, rowGap, colGap, collapse, root) : null;
  const after = next ? between(me, slotOf(next), rowGap, colGap, collapse, root) : null;
  if (before) out.push(before);
  if (after) out.push(after);
  return out;
};

/**
 * 選んだ要素の中で、隣り合う子と子の間に空いている距離を帯にする。
 * 箱を選んで中の間隔を一度に見るための口で、`↑`/`↓` で辿った先がそのまま検分の対象になる。
 * @param el 対象の要素
 * @param root ルートの文字サイズ
 * @returns 帯の配列
 */
const innerBands = (el: Element, root: number): Band[] => {
  const { rowGap, colGap, collapse } = layoutOf(el);
  const kids = [...el.children].map(slotOf).filter(({ rect }) => rect.width > 0 || rect.height > 0);
  const out: Band[] = [];
  for (let i = 1; i < kids.length && out.length < INNER_MAX; i++) {
    const a = kids[i - 1];
    const b = kids[i];
    if (!a || !b) continue;
    const band = between(a, b, rowGap, colGap, collapse, root);
    if (band) out.push(band);
  }
  return out;
};

/**
 * 中身のある最初の子。降りる先が無ければ null。
 * 大きさゼロの子は飛ばす——選んでも何も見えず、辿る道が行き止まりになるため。
 * @param el 親
 * @returns 降りる先
 */
const firstSizableChild = (el: Element): Element | null => {
  for (const kid of el.children) {
    const rect = kid.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return kid;
  }
  return null;
};

/** 起動。2度目の呼び出しは切り替えになる。 */
const start = (): void => {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    .band { position: fixed; box-sizing: border-box; }
    .band > span {
      position: absolute; left: 0; top: 0;
      font: 700 11px ui-monospace, Consolas, monospace; color: #0b0d10;
      padding: 1px 5px; border-radius: 4px; white-space: nowrap;
    }
    /* 幅も行数も固定にする。中身で寸法が変わると、指について回るぶん暴れて見える。 */
    #panel {
      /* 広い画面では 360px で据え置き。狭い窓では幅いっぱいを占めてしまうので、その割合で抑える。 */
      position: fixed; width: min(360px, 76vw, calc(100vw - 24px)); box-sizing: border-box;
      background: #14161ae6; color: #e9ecf1;
      border: 1px solid #3a414d; border-radius: 8px; padding: 8px 10px;
      font: 12px/1.55 ui-monospace, Consolas, monospace; backdrop-filter: blur(6px); display: none;
      box-shadow: 0 6px 24px #0009;
    }
    #panel b { color: #fff; font-weight: 700; }
    #panel .k { color: #8b95a5; flex: none; }
    #panel .row { display: flex; gap: 10px; justify-content: space-between; }
    #panel .row b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 見出しは外形の色に揃える——いま囲っているものの名を、囲みと同じ色で名乗らせる。 */
    #panel .head {
      color: ${EDGE}; margin-bottom: 4px; text-shadow: 0 0 8px ${EDGE}80;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #panel .hint { color: #6b7482; margin-top: 6px; font-size: 11px; }
  </style><div id="bands"></div><div id="panel"></div>`;
  const bandsRoot = shadow.getElementById("bands") as HTMLDivElement;
  const panel = shadow.getElementById("panel") as HTMLDivElement;
  document.documentElement.appendChild(host);

  let target: Element | null = null;
  let frozen = false;
  let pointer = { x: 0, y: 0 };
  let frame = 0;
  // ↑で登った道。↓のとき、来た道をそのまま降りるために覚えておく。
  let descent: Element[] = [];
  // 立ち上げた時点の画素比。以後これとの比を拡大の度合いとみなし、道具だけ逆に縮める
  // ——拡大は CSS の 1px ごと引き伸ばすので、そのままではパネルが画面を食い潰す。
  const baseRatio = window.devicePixelRatio || 1;

  /** 帯を敷き直す。 */
  const draw = (): void => {
    frame = 0;
    // 相手が決まるまでパネルは出さない。指で触る画面では hover が無く、最初の一触りまで
    // 中身の無い箱が左上に居座って見える。
    if (!target || !target.isConnected) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    const cs = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const num = (v: string) => parseFloat(v) || 0;
    const m = { t: num(cs.marginTop), r: num(cs.marginRight), b: num(cs.marginBottom), l: num(cs.marginLeft) };
    const p = { t: num(cs.paddingTop), r: num(cs.paddingRight), b: num(cs.paddingBottom), l: num(cs.paddingLeft) };

    const bands: Band[] = [
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height, color: EDGE, label: "" },
    ];
    if (m.t > 0) bands.push({ x: rect.left, y: rect.top - m.t, w: rect.width, h: m.t, color: MARGIN, label: `margin ${withRem(m.t, root)}` });
    if (m.b > 0) bands.push({ x: rect.left, y: rect.bottom, w: rect.width, h: m.b, color: MARGIN, label: `margin ${withRem(m.b, root)}` });
    if (p.t > 0) bands.push({ x: rect.left, y: rect.top, w: rect.width, h: p.t, color: PAD, label: `padding ${withRem(p.t, root)}` });
    if (p.b > 0) bands.push({ x: rect.left, y: rect.bottom - p.b, w: rect.width, h: p.b, color: PAD, label: `padding ${withRem(p.b, root)}` });
    if (p.l > 0) bands.push({ x: rect.left, y: rect.top + p.t, w: p.l, h: rect.height - p.t - p.b, color: PAD, label: `padding ${withRem(p.l, root)}` });
    if (p.r > 0) bands.push({ x: rect.right - p.r, y: rect.top + p.t, w: p.r, h: rect.height - p.t - p.b, color: PAD, label: `padding ${withRem(p.r, root)}` });
    bands.push(...siblingBands(target, root));
    bands.push(...innerBands(target, root));

    // 同じ文言を省くのは、その要素自身の四辺（padding・margin）だけ。
    // 隙間は省かない——同じ値の隙間が並ぶ場所では、1本にしか札が付かず、残りが無言の帯になる。
    const said = new Set<string>();
    for (const band of bands) {
      if (!band.label || (band.color !== PAD && band.color !== MARGIN)) continue;
      if (said.has(band.label)) band.label = "";
      else said.add(band.label);
    }

    const name =
      target.tagName.toLowerCase() +
      (target.id ? `#${target.id}` : "") +
      (typeof target.className === "string" && target.className ? `.${target.className.trim().split(/\s+/).join(".")}` : "");
    const row = (k: string, v: string) => `<div class="row"><span class="k">${k}</span><b>${v}</b></div>`;
    const text = readColor(cs.color);
    const back = readColor(cs.backgroundColor);
    // 行は常に全部出す。有無で行数が変わると、指について回るパネルの丈が伸び縮みして酔う。
    const gapText = /flex|grid/.test(cs.display)
      ? cs.rowGap === cs.columnGap
        ? cs.rowGap
        : `行 ${cs.rowGap} / 列 ${cs.columnGap}`
      : "—";
    panel.innerHTML =
      `<div class="head">${name}</div>` +
      row("外形", `${Math.round(rect.width * 10) / 10} × ${Math.round(rect.height * 10) / 10}px`) +
      row("幅", withRem(rect.width, root)) +
      row("高さ", withRem(rect.height, root)) +
      row("padding", `${p.t} ${p.r} ${p.b} ${p.l}`) +
      row("margin", `${m.t} ${m.r} ${m.b} ${m.l}`) +
      row("gap（中）", gapText) +
      row("文字", `${cs.fontSize} / 行 ${cs.lineHeight}`) +
      row("色", text ?? "—") +
      row("背景", back ?? "—") +
      `<div class="hint">${frozen ? "固定中（クリックで解除）" : "クリックで固定"} ・ ↑親へ ↓子へ ・ C で色を吸う（Shift で # 無し）・ Esc で終了</div>`;

    // パネルは指の右下へ。画面から出るときだけ内側へ寄せる。
    // 幅は clientWidth で見る——innerWidth はスクロールバーを含み、そのぶん右へはみ出す。
    const view = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    // 拡大されている間は、その逆数で縮める。見た目の大きさは拡大前と変わらない。
    const zoom = Math.max(1, (window.devicePixelRatio || 1) / baseRatio);
    const shrink = zoom > 1.02 ? `scale(${(1 / zoom).toFixed(4)})` : "";
    panel.style.transformOrigin = "top left";
    panel.style.transform = shrink;
    // 縮めた後の見た目の寸法で置き場所を決める（offsetWidth は縮める前の値を返す）。
    const panelW = panel.offsetWidth / zoom;
    const panelH = panel.offsetHeight / zoom;
    const panelLeft = Math.max(8, Math.min(pointer.x + 16, view.w - panelW - 8));
    const panelTop = Math.max(8, Math.min(pointer.y + 16, view.h - panelH - 8));
    panel.style.left = `${panelLeft}px`;
    panel.style.top = `${panelTop}px`;

    // 先に埋まっている場所。パネルを最初に置き、札はそれと既に置いた札を避ける。
    const taken = [{ x: panelLeft, y: panelTop, w: panelW, h: panelH }];
    const free = (x: number, y: number, w: number, h: number): boolean =>
      !taken.some((t) => x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y);

    bandsRoot.textContent = "";
    for (const b of bands) {
      const el = document.createElement("div");
      el.className = "band";
      const fill = b.color === EDGE ? "transparent" : `${b.color}38`;
      // 外へ滲ませる。ネオンらしさは色の鮮やかさではなく、この滲みが作る。
      el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${fill};outline:1px solid ${b.color};box-shadow:0 0 7px ${b.color}80;`;
      // 札より先に帯を入れる。DOM の外では offsetWidth が 0 になり、寸法が測れない。
      bandsRoot.appendChild(el);
      if (!b.label) continue;
      const tag = document.createElement("span");
      tag.style.background = b.color;
      tag.style.boxShadow = `0 0 8px ${b.color}b0`;
      tag.textContent = b.label;
      el.appendChild(tag);
      tag.style.transformOrigin = "top left";
      tag.style.transform = shrink;
      const width = tag.offsetWidth / zoom;
      const height = tag.offsetHeight / zoom;
      // 太い帯は左端へ寄せ、細い帯は札のほうが大きいので中央に跨がせる（持ち主を示すため）。
      const wantX = b.w >= LABEL_ROOM ? b.x + 4 : b.x + b.w / 2 - width / 2;
      const wantY = b.y + b.h / 2 - height / 2;
      const x = Math.max(4, Math.min(wantX, view.w - width - 4));
      let y = Math.max(2, Math.min(wantY, view.h - height - 2));
      let placed = free(x, y, width, height);
      if (!placed) {
        // 塞がっていたら上下へずらして空きを探す。どこも埋まっていれば、その札は出さない。
        const step = height + 3;
        for (const shift of [step, -step, step * 2, -step * 2, step * 3, -step * 3]) {
          const next = Math.max(2, Math.min(wantY + shift, view.h - height - 2));
          if (free(x, next, width, height)) {
            y = next;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        tag.remove();
        continue;
      }
      taken.push({ x, y, w: width, h: height });
      tag.style.left = `${x - b.x}px`;
      tag.style.top = `${y - b.y}px`;
    }
  };

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };

  // pointer で拾うのは、スマホ表示（タッチの真似）では hover が存在せず mousemove が一度も鳴らないため。
  // 指で押しながら滑らせると pointermove は鳴るので、そちらでも辿れる。
  const onMove = (e: MouseEvent): void => {
    pointer = { x: e.clientX, y: e.clientY };
    if (frozen) return schedule();
    const found = document.elementFromPoint(e.clientX, e.clientY);
    if (found && found !== host && found !== target) {
      target = found;
      descent = [];
    }
    schedule();
  };

  // ページのボタンやリンクを踏まないよう、掴んでいる間の click は握り潰す（DOM には触れない）。
  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    frozen = !frozen;
    schedule();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!owns(e)) return;
    // 動く前に握り潰す。入力欄に焦点があっても文字は入らず、ページ側の仕掛けも鳴らない。
    // 打ち上げまで潰すのは、keyup で動く手癖に素通りさせないため。
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "keydown") return;
    const key = e.key.toLowerCase();
    if (key === "escape") return stop();
    if (key === "c") return void pick(e.shiftKey);
    if (key === "arrowup" && target?.parentElement) {
      descent.push(target);
      target = target.parentElement;
      frozen = true;
      schedule();
    }
    if (key === "arrowdown" && target) {
      const back = descent.pop();
      // 来た道が残っていればそこへ戻し、無ければ最初の子へ降りる。
      const next =
        back && back.isConnected && back.parentElement === target ? back : firstSizableChild(target);
      if (next) {
        target = next;
        frozen = true;
        schedule();
      }
    }
  };

  /**
   * 画面の1点から色を吸う。ページには触れない公式の口。
   * @param bare 先頭の `#` を落とすか（`#` を自前で持つ入力欄へ渡すとき用）
   */
  const pick = async (bare: boolean): Promise<void> => {
    const Dropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } })
      .EyeDropper;
    if (!Dropper) return;
    try {
      const { sRGBHex } = await new Dropper().open();
      await navigator.clipboard.writeText(bare ? sRGBHex.replace(/^#/, "") : sRGBHex);
    } catch {
      // 取り消しは何もしない。
    }
  };

  const onScroll = (): void => schedule();

  const stop = (): void => {
    for (const kind of MOVE_EVENTS) removeEventListener(kind, onMove, true);
    removeEventListener("click", onClick, true);
    removeEventListener("keydown", onKey, true);
    removeEventListener("keyup", onKey, true);
    removeEventListener("scroll", onScroll, true);
    removeEventListener("resize", onScroll);
    if (frame !== 0) cancelAnimationFrame(frame);
    host.remove();
    window.__px01 = undefined;
  };

  for (const kind of MOVE_EVENTS) addEventListener(kind, onMove, true);
  addEventListener("click", onClick, true);
  addEventListener("keydown", onKey, true);
  addEventListener("keyup", onKey, true);
  addEventListener("scroll", onScroll, true);
  addEventListener("resize", onScroll);

  window.__px01 = { build: __PX01_BUILD__, toggle: stop };
};

// 拡張を焼き直しても、既にページへ流し込まれた中身は生き続ける（chrome.* を使わないので死なない）。
// 版が違うなら畳んでから立て直す——さもないと「押す・止まる・もう一度押す」の二度手間になる。
if (window.__px01 && window.__px01.build === __PX01_BUILD__) {
  window.__px01.toggle();
} else {
  window.__px01?.toggle();
  start();
}

// declare global を使うため、このファイルをモジュールにする（束ねると IIFE に包まれる）。
export {};
