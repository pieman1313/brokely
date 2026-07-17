// Export an on-page SVG (the money-flow Sankey) as a standalone PNG.
// The SVG uses CSS variables + classes for colour/typography, so we inline the
// computed styles onto a clone before rasterising — otherwise the export is blank.

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linejoin",
  "opacity", "font-family", "font-size", "font-weight", "text-anchor", "paint-order",
];

function inlineStyles(source: Element, clone: Element) {
  const srcEls = [source, ...Array.from(source.querySelectorAll("*"))];
  const cleEls = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (let i = 0; i < srcEls.length; i++) {
    const cs = getComputedStyle(srcEls[i]);
    const decl = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    cleEls[i].setAttribute("style", decl);
  }
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export async function exportSvgPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  const w = svg.clientWidth || Number(svg.getAttribute("width")) || 900;
  const h = svg.clientHeight || Number(svg.getAttribute("height")) || 600;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  // opaque background so the PNG isn't transparent
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(w));
  bg.setAttribute("height", String(h));
  bg.setAttribute("fill", cssVar("--surface-1", "#ffffff"));
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const img = new Image();
    img.width = w;
    img.height = h;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to render SVG"));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const dl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = dl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          // defer revoke so the download has started reading the blob (Firefox-safe)
          setTimeout(() => URL.revokeObjectURL(dl), 1000);
        }
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
