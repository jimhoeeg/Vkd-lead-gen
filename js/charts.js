/* Små SVG-grafer uden afhængigheder. Tooltips via [data-tip] (delegeret i app.js). */
(function (root) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  const roundTopRect = (x, y, w, h, r, up) => {
    // stang med 4px afrunding i dataenden, flad mod nul-linjen
    r = Math.min(r, w / 2, Math.abs(h));
    if (h <= 0) return '';
    if (up) return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  };

  /**
   * Grupperet søjlediagram.
   * opts: { categories, series:[{name,color,values,colors?}], fmt, height, ariaLabel }
   */
  function bars(opts) {
    const W = 640, H = opts.height || 260, m = { t: 14, r: 10, b: 40, l: 64 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = opts.series.flatMap((s) => s.values);
    const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const nC = opts.categories.length, nS = opts.series.length;
    const band = iw / nC;
    const gap = 2;
    const bw = Math.min(56, (band * 0.7 - gap * (nS - 1)) / nS);
    const groupW = bw * nS + gap * (nS - 1);
    const fmt = opts.fmt || ((v) => v);
    let g = '';
    for (const t of ticks) {
      g += `<line class="${t === 0 ? 'zero' : 'gridline'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      g += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
    }
    opts.categories.forEach((c, i) => {
      const gx = m.l + band * i + (band - groupW) / 2;
      opts.series.forEach((s, j) => {
        const v = s.values[i];
        const x = gx + j * (bw + gap);
        const up = v >= 0;
        const top = up ? y(v) : y(0);
        const h = Math.abs(y(v) - y(0));
        const color = (s.colors && s.colors[i]) || s.color;
        const tip = `<b>${esc(c)}</b><br>${esc(s.name)}: ${esc(fmt(v))}`;
        g += `<path d="${roundTopRect(x, top, bw, h, 4, up)}" style="fill:${color}"/>`;
        g += `<rect x="${x - 3}" y="${m.t}" width="${bw + 6}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
      });
      g += `<text class="axis-label" x="${m.l + band * i + band / 2}" y="${H - m.b + 18}" text-anchor="middle">${esc(c)}</text>`;
    });
    const legend = nS > 1
      ? `<div class="legend">${opts.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    return `<div class="chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || '')}">${g}</svg></div>`;
  }

  /**
   * Linjediagram med crosshair-tooltip pr. x-værdi.
   * opts: { xs, series:[{name,color,values,dash?}], fmt, xfmt, height, ariaLabel, markX }
   */
  function lines(opts) {
    const W = 640, H = opts.height || 260, m = { t: 14, r: 16, b: 34, l: 70 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = opts.series.flatMap((s) => s.values);
    const ticks = niceTicks(Math.min(opts.zeroBased === false ? Math.min(...all) : 0, ...all), Math.max(...all, 0));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const n = opts.xs.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const fmt = opts.fmt || ((v) => v), xfmt = opts.xfmt || ((v) => v);
    let g = '';
    for (const t of ticks) {
      g += `<line class="${t === 0 ? 'zero' : 'gridline'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      g += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
    }
    const every = Math.ceil(n / 8);
    opts.xs.forEach((xv, i) => {
      if (i % every === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - m.b + 18}" text-anchor="middle">${esc(xfmt(xv))}</text>`;
    });
    if (opts.markX != null) {
      const i = opts.xs.indexOf(opts.markX);
      if (i >= 0) g += `<line x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ih}" style="stroke:var(--accent)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    }
    for (const s of opts.series) {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      g += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 4"' : ''}/>`;
    }
    // Hover-bånd
    const bw = n > 1 ? iw / (n - 1) : iw;
    opts.xs.forEach((xv, i) => {
      const tip = `<b>${esc(xfmt(xv))}</b>` + opts.series.map((s) => `<br><span style="color:${s.color}">●</span> ${esc(s.name)}: ${esc(fmt(s.values[i]))}`).join('');
      g += `<g class="hb"><line x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ih}" style="stroke:var(--ink-2)" stroke-width="1" opacity="0"/>`;
      for (const s of opts.series) g += `<circle cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" style="fill:${s.color};stroke:var(--surface)" stroke-width="2" opacity="0"/>`;
      g += `<rect x="${x(i) - bw / 2}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/></g>`;
    });
    const legend = opts.series.length > 1
      ? `<div class="legend">${opts.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    return `<div class="chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || '')}"><style>.hb:hover line,.hb:hover circle{opacity:1}</style>${g}</svg></div>`;
  }

  root.VKCharts = { bars, lines, niceTicks };
})(typeof window !== 'undefined' ? window : globalThis);
