// Generates Brokely's icon set — a nervous, broke little coin — into public/.
// The mascot is defined once (parametric SVG) and rendered to PNGs via headless
// Chrome at each required size. Re-run after tweaking the design:
//   node scripts/gen-icons.mjs
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9350;
const OUT = `${process.cwd()}/public`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the mascot: a worried coin with a sweat drop ----
function mascot(cx, cy, R) {
  const eyeY = cy - 0.14 * R;
  const exL = cx - 0.34 * R, exR = cx + 0.34 * R;
  const eR = 0.115 * R;
  const browY = eyeY - 0.32 * R;
  const mY = cy + 0.46 * R;
  const st = 0.075 * R;
  const seg = 0.16 * R;          // width of each mouth wiggle
  const amp = 0.13 * R;          // wiggle height
  const x0 = cx - 2 * seg;
  const mouth = `M ${x0} ${mY} q ${seg / 2} ${-amp} ${seg} 0 q ${seg / 2} ${amp} ${seg} 0 q ${seg / 2} ${-amp} ${seg} 0 q ${seg / 2} ${amp} ${seg} 0`;
  const sx = cx + 0.52 * R, sy = cy - 0.52 * R, s = 0.17 * R;
  const drop = `M ${sx} ${sy} c ${s} ${s * 1.7} ${s * 1.25} ${s * 2.3} ${-s * 0.1} ${s * 2.9} c ${-s * 1.15} ${s * 0.5} ${-s * 2.05} ${-s * 0.45} ${-s * 1.5} ${-s * 1.5} c ${s * 0.2} ${-s * 0.75} ${s * 0.7} ${-s * 1.55} ${s * 1.6} ${-s * 1.4} z`;
  const ink = "#3a2a06";
  return `
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#coin)" stroke="#b9800f" stroke-width="${0.055 * R}"/>
    <circle cx="${cx}" cy="${cy}" r="${0.83 * R}" fill="none" stroke="#b9800f" stroke-opacity="0.4" stroke-width="${0.03 * R}"/>
    <path d="M ${exL - eR * 1.4} ${browY + 0.14 * R} Q ${exL} ${browY} ${exL + eR * 1.4} ${browY + 0.05 * R}" fill="none" stroke="${ink}" stroke-width="${st * 0.9}" stroke-linecap="round"/>
    <path d="M ${exR - eR * 1.4} ${browY + 0.05 * R} Q ${exR} ${browY} ${exR + eR * 1.4} ${browY + 0.14 * R}" fill="none" stroke="${ink}" stroke-width="${st * 0.9}" stroke-linecap="round"/>
    <circle cx="${exL}" cy="${eyeY}" r="${eR}" fill="${ink}"/>
    <circle cx="${exR}" cy="${eyeY}" r="${eR}" fill="${ink}"/>
    <circle cx="${exL + eR * 0.34}" cy="${eyeY - eR * 0.34}" r="${eR * 0.34}" fill="#fff"/>
    <circle cx="${exR + eR * 0.34}" cy="${eyeY - eR * 0.34}" r="${eR * 0.34}" fill="#fff"/>
    <path d="${mouth}" fill="none" stroke="${ink}" stroke-width="${st}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${drop}" fill="#5bb0ff" stroke="#2f8fe0" stroke-width="${0.02 * R}"/>
  `;
}

const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#008300"/><stop offset="1" stop-color="#2a78d6"/>
  </linearGradient>
  <linearGradient id="coin" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffdd80"/><stop offset="1" stop-color="#f2b01e"/>
  </linearGradient>
</defs>`;

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${defs}${inner}</svg>`;
// rounded app icon, transparent corners
const appSvg = svg(`<rect x="8" y="8" width="496" height="496" rx="112" fill="url(#bg)"/>${mascot(256, 270, 150)}`);
// maskable: full-bleed bg, glyph inside the ~80% safe zone
const maskableSvg = svg(`<rect width="512" height="512" fill="url(#bg)"/>${mascot(256, 256, 118)}`);
// favicon: tight + bold so it reads at 16px
const faviconSvg = svg(`<rect width="512" height="512" rx="96" fill="url(#bg)"/>${mascot(256, 268, 178)}`);

// favicon.svg is shipped as-is (scalable, modern browsers)
writeFileSync(`${OUT}/favicon.svg`, faviconSvg);

const RENDERS = [
  { svg: appSvg, size: 192, out: "icon-192.png" },
  { svg: appSvg, size: 512, out: "icon-512.png" },
  { svg: maskableSvg, size: 512, out: "maskable-512.png" },
  { svg: maskableSvg, size: 180, out: "apple-touch-icon.png" },
  { svg: faviconSvg, size: 32, out: "favicon-32.png" },
  { svg: faviconSvg, size: 16, out: "favicon-16.png" },
];

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cdp-icons", "about:blank"]);
async function gt() { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${PORT}/json`); const l = await r.json(); const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p; } catch {} await sleep(250); } throw new Error("no target"); }

try {
  const page = await gt();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  await send("Page.enable", {});
  for (const r of RENDERS) {
    const html = `<!doctype html><meta charset=utf8><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${r.svg}`;
    const dataUrl = `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
    await send("Emulation.setDeviceMetricsOverride", { width: r.size, height: r.size, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send("Page.navigate", { url: dataUrl });
    await sleep(350);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: r.size, height: r.size, scale: 1 } });
    writeFileSync(`${OUT}/${r.out}`, Buffer.from(shot.result.data, "base64"));
    console.log(`wrote public/${r.out} (${r.size}px)`);
  }
  console.log("wrote public/favicon.svg");
  ws.close();
} finally { chrome.kill("SIGKILL"); }
