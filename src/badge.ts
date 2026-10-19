// The README badge: [☕ buy me a coffee | send21], shields.io style, no external fonts or images.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Rough Verdana 11px width: good enough for a badge, emoji count as two. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x2000) w += cp === 0xfe0f ? 0 : 14;
    else if ("ijl.,:;'|!".includes(ch)) w += 3.5;
    else if ("mwMW".includes(ch)) w += 10;
    else if (ch === " ") w += 3.6;
    else if (/[A-Z0-9]/.test(ch)) w += 7.5;
    else w += 6.6;
  }
  return Math.ceil(w);
}

export function badgeSvg(left: string, right = "send21"): string {
  const lw = textWidth(left) + 20;
  const rw = textWidth(right) + 20;
  const w = lw + rw;
  const label = `${left} | ${right}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" viewBox="0 0 ${w} 24" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".12"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="24" rx="6"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="24" fill="#1b1c20"/><rect x="${lw}" width="${rw}" height="24" fill="#f7931a"/><rect width="${w}" height="24" fill="url(#g)"/></g>
<g font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" font-weight="700" text-anchor="middle">
<text x="${lw / 2}" y="16" fill="#fef8ec">${esc(left)}</text>
<text x="${lw + rw / 2}" y="16" fill="#1b1c20">${esc(right)}</text>
</g></svg>`;
}
