/* charts.js — dependency-free SVG charts.
   Method: thin marks, hairline solid grid, selective labels, hover tooltips,
   table-view twin for every chart, colors via validated CSS custom properties. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const C = (App.charts = {});

  const NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs, children) {
    const el = document.createElementNS(NS, name);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    (children || []).forEach((c) => el.appendChild(c));
    return el;
  }
  function txt(el, s) { el.textContent = s; return el; }

  const FONT = 'font-family="-apple-system, Segoe UI, system-ui, sans-serif"';

  function niceTicks(maxV, count) {
    count = count || 4;
    if (maxV <= 0) return [0, 1];
    const rough = maxV / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(maxV / step) * step; // always cover the max value
    const ticks = [];
    for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return ticks;
  }

  /* ---------- tooltip singleton ---------- */
  const tipEl = () => document.getElementById("chart-tooltip");
  C.tipShow = function (clientX, clientY, data) {
    const el = tipEl();
    el.innerHTML = "";
    if (data.title) {
      const t = document.createElement("div");
      t.className = "tt-title";
      t.textContent = data.title;
      el.appendChild(t);
    }
    for (const row of data.rows || []) {
      const r = document.createElement("div");
      r.className = "tt-row";
      const key = document.createElement("span");
      key.className = "tt-key";
      key.style.background = row.color || "transparent";
      const lab = document.createElement("span");
      lab.className = "tt-label";
      lab.textContent = row.label;
      const val = document.createElement("span");
      val.className = "tt-val";
      val.textContent = row.value;
      r.append(key, lab, val);
      el.appendChild(r);
    }
    el.hidden = false;
    const rect = el.getBoundingClientRect();
    let x = clientX + 14, y = clientY + 12;
    if (x + rect.width > innerWidth - 10) x = clientX - rect.width - 12;
    if (y + rect.height > innerHeight - 10) y = clientY - rect.height - 10;
    el.style.left = x + "px";
    el.style.top = y + "px";
  };
  C.tipHide = function () { const el = tipEl(); if (el) el.hidden = true; };

  /* ---------- chart card shell with chart/table toggle ---------- */
  C.card = function (id, title, sub, extraHTML) {
    return `
      <div class="card chart-card" data-chart-card="${esc(id)}">
        <div class="chart-head">
          <div>
            <div class="ct">${esc(title)}</div>
            ${sub ? `<div class="cs">${esc(sub)}</div>` : ""}
          </div>
          <div class="row" style="gap:8px;flex-shrink:0">
            ${extraHTML || ""}
            <div class="view-toggle" role="tablist" aria-label="View as">
              <button class="active" data-view="chart" title="Chart view" aria-label="Chart view">${App.icon("chartMini")}</button>
              <button data-view="table" title="Table view" aria-label="Table view">${App.icon("table")}</button>
            </div>
          </div>
        </div>
        <div class="chart-body"></div>
      </div>`;
  };

  // Wires up a card: renderChart(bodyEl), tableSpec {columns:[], rows:[[..]]}
  C.mountCard = function (rootEl, id, renderChart, tableSpec) {
    const card = rootEl.querySelector(`[data-chart-card="${CSS.escape(id)}"]`);
    if (!card) return;
    const body = card.querySelector(".chart-body");
    const btns = card.querySelectorAll(".view-toggle button");
    function show(view) {
      btns.forEach((b) => b.classList.toggle("active", b.dataset.view === view));
      body.innerHTML = "";
      C.tipHide();
      if (view === "chart") renderChart(body);
      else body.appendChild(buildTable(tableSpec));
    }
    btns.forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
    show("chart");
  };

  function buildTable(spec) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap tbl-view";
    const table = document.createElement("table");
    table.className = "tbl";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    spec.columns.forEach((c, i) => {
      const th = document.createElement("th");
      th.textContent = c;
      if (i > 0) th.className = "right";
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    const tbody = document.createElement("tbody");
    if (!spec.rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = spec.columns.length;
      td.textContent = "No data yet";
      td.style.color = "var(--ink-3)";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    spec.rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        td.textContent = cell;
        if (i > 0) { td.className = "right"; td.style.fontVariantNumeric = "tabular-nums"; }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    wrap.appendChild(table);
    return wrap;
  }

  C.emptyNote = function (body, msg) {
    const d = document.createElement("div");
    d.className = "chart-empty";
    d.textContent = msg;
    body.appendChild(d);
  };

  function roundedTopBar(x, y, w, h, r) {
    if (h <= 0) return null;
    r = Math.min(r, w / 2, h);
    const d = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
    return svgEl("path", { d });
  }
  function roundedEndBarH(x, y, w, h, r, dir) {
    // horizontal bar; rounded on the data end. dir: 1 = grows right, -1 = grows left
    r = Math.min(r, h / 2, Math.abs(w));
    if (Math.abs(w) < 0.5) return null;
    let d;
    if (dir > 0) {
      d = `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
    } else {
      d = `M${x},${y} L${x + w + r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w + r},${y + h} L${x},${y + h} Z`;
    }
    return svgEl("path", { d });
  }

  /* ============================================================
     Column chart + threshold step-line (workload vs capacity)
     data: [{label, value, capacity, tipTitle}]
     ============================================================ */
  C.columnWithCapacity = function (body, data, opts) {
    opts = opts || {};
    if (!data.length || data.every((d) => !d.value && !d.capacity)) {
      C.emptyNote(body, opts.emptyMsg || "Nothing here yet");
      return;
    }
    const W = 760, H = 240, padL = 46, padR = 10, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = Math.max(...data.map((d) => Math.max(d.value, d.capacity || 0)), 1);
    const ticks = niceTicks(maxV);
    const yMax = ticks[ticks.length - 1];
    const y = (v) => padT + plotH - (v / yMax) * plotH;
    const slotW = plotW / data.length;
    const barW = Math.min(24, slotW * 0.62);

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

    ticks.forEach((tv) => {
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(tv), y2: y(tv), stroke: "var(--grid)", "stroke-width": 1 }));
      const t = svgEl("text", { x: padL - 7, y: y(tv) + 3.5, "text-anchor": "end", "font-size": 10, fill: "var(--ink-3)", style: "font-variant-numeric:tabular-nums" });
      txt(t, opts.fmtTick ? opts.fmtTick(tv) : String(tv));
      svg.appendChild(t);
    });

    // bars
    data.forEach((d, i) => {
      const cx = padL + slotW * i + slotW / 2;
      const over = d.capacity !== undefined && d.value > d.capacity && d.capacity >= 0;
      const bar = roundedTopBar(cx - barW / 2, y(d.value), barW, plotH + padT - y(d.value), 4);
      if (bar) {
        bar.setAttribute("fill", over ? "var(--danger)" : "var(--series-1)");
        svg.appendChild(bar);
      }
      if (i % (opts.labelEvery || 5) === 0) {
        const t = svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle", "font-size": 10, fill: "var(--ink-3)" });
        txt(t, d.label);
        svg.appendChild(t);
      }
    });

    // capacity step line
    if (data.some((d) => d.capacity !== undefined)) {
      let path = "";
      data.forEach((d, i) => {
        const x0 = padL + slotW * i, x1 = padL + slotW * (i + 1);
        const yy = y(d.capacity || 0);
        path += (i === 0 ? `M${x0},${yy}` : `L${x0},${yy}`) + `L${x1},${yy}`;
      });
      svg.appendChild(svgEl("path", { d: path, fill: "none", stroke: "var(--ink-2)", "stroke-width": 2, "stroke-dasharray": "5 4", "stroke-linecap": "round" }));
    }

    // hover targets
    data.forEach((d, i) => {
      const hit = svgEl("rect", { x: padL + slotW * i, y: padT, width: slotW, height: plotH, fill: "transparent" });
      hit.addEventListener("pointermove", (e) => {
        const over = d.capacity !== undefined && d.value > d.capacity;
        C.tipShow(e.clientX, e.clientY, {
          title: d.tipTitle || d.label,
          rows: [
            { color: over ? "var(--danger)" : "var(--series-1)", label: opts.valueLabel || "Planned", value: opts.fmtVal ? opts.fmtVal(d.value) : d.value },
            ...(d.capacity !== undefined ? [{ color: "var(--ink-2)", label: "Capacity", value: opts.fmtVal ? opts.fmtVal(d.capacity) : d.capacity }] : []),
          ],
        });
      });
      hit.addEventListener("pointerleave", C.tipHide);
      svg.appendChild(hit);
    });

    body.appendChild(svg);

    // single-series bars need no legend; the capacity variant explains its 3 keys
    if (data.some((d) => d.capacity !== undefined)) {
      const legend = document.createElement("div");
      legend.className = "chart-legend";
      legend.innerHTML = `
        <span class="lg-item"><span class="lg-swatch" style="background:var(--series-1)"></span>${esc(opts.valueLabel || "Planned")}</span>
        <span class="lg-item"><span class="lg-swatch" style="background:var(--danger)"></span>Over capacity</span>
        <span class="lg-item"><span class="lg-line" style="background:var(--ink-2)"></span>Daily capacity</span>`;
      body.appendChild(legend);
    }
  };

  /* ============================================================
     Horizontal diverging bars (task drag by subject)
     data: [{label, value, count}] — value >0 late (red), <0 early (blue)
     ============================================================ */
  C.divergingBars = function (body, data, opts) {
    opts = opts || {};
    if (!data.length) { C.emptyNote(body, opts.emptyMsg || "Nothing here yet"); return; }
    const rowH = 30, W = 720, padL = 120, padR = 52, padT = 8, padB = 22;
    const H = padT + padB + rowH * data.length;
    const plotW = W - padL - padR;
    const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 1);
    const x = (v) => padL + plotW / 2 + (v / maxAbs) * (plotW / 2) * 0.92;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    // zero baseline
    svg.appendChild(svgEl("line", { x1: x(0), x2: x(0), y1: padT, y2: H - padB, stroke: "var(--hairline-2)", "stroke-width": 1 }));

    data.forEach((d, i) => {
      const cy = padT + rowH * i + rowH / 2;
      const barH = 15;
      const w = x(d.value) - x(0);
      const bar = roundedEndBarH(x(0), cy - barH / 2, w, barH, 4, w >= 0 ? 1 : -1);
      if (bar) {
        bar.setAttribute("fill", d.value > 0 ? "var(--danger)" : "var(--series-1)");
        svg.appendChild(bar);
      }
      const lab = svgEl("text", { x: padL - 9, y: cy + 3.5, "text-anchor": "end", "font-size": 11, fill: "var(--ink-2)" });
      txt(lab, d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label);
      svg.appendChild(lab);
      const valT = svgEl("text", {
        x: x(d.value) + (d.value >= 0 ? 6 : -6), y: cy + 3.5,
        "text-anchor": d.value >= 0 ? "start" : "end",
        "font-size": 10.5, "font-weight": 600, fill: "var(--ink-2)",
        style: "font-variant-numeric:tabular-nums",
      });
      txt(valT, (d.value > 0 ? "+" : "") + d.value + "d");
      svg.appendChild(valT);

      const hit = svgEl("rect", { x: 0, y: padT + rowH * i, width: W, height: rowH, fill: "transparent" });
      hit.addEventListener("pointermove", (e) => {
        C.tipShow(e.clientX, e.clientY, {
          title: d.label,
          rows: [
            { color: d.value > 0 ? "var(--danger)" : "var(--series-1)", label: d.value > 0 ? "Avg days late" : "Avg days early", value: Math.abs(d.value) + "d" },
            { color: "transparent", label: "Tasks measured", value: String(d.count) },
          ],
        });
      });
      hit.addEventListener("pointerleave", C.tipHide);
      svg.appendChild(hit);
    });

    const axis = svgEl("text", { x: x(0), y: H - 6, "text-anchor": "middle", "font-size": 9.5, fill: "var(--ink-3)" });
    txt(axis, "on time");
    svg.appendChild(axis);
    body.appendChild(svg);

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = `
      <span class="lg-item"><span class="lg-swatch" style="background:var(--series-1)"></span>Finished early</span>
      <span class="lg-item"><span class="lg-swatch" style="background:var(--danger)"></span>Finished late</span>`;
    body.appendChild(legend);
  };

  /* ============================================================
     Donut (time by subject) — fixed slot order, >7 folds to Other
     data: [{label, value}]
     ============================================================ */
  C.donut = function (body, rawData, opts) {
    opts = opts || {};
    let data = [...rawData].sort((a, b) => b.value - a.value).filter((d) => d.value > 0);
    if (!data.length) { C.emptyNote(body, opts.emptyMsg || "Nothing here yet"); return; }
    if (data.length > 7) {
      const head = data.slice(0, 6);
      const other = data.slice(6).reduce((s, d) => s + d.value, 0);
      data = [...head, { label: "Other", value: other, isOther: true }];
    }
    const total = data.reduce((s, d) => s + d.value, 0);
    // per-datum color (e.g. the student's subject colors) beats the slot palette
    const seriesVar = (i, d) => (d.isOther ? "var(--dim-mark)" : d.color || `var(--series-${i + 1})`);

    const size = 210, cx = size / 2, cy = size / 2, r = 78, inner = 50;
    const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, role: "img", style: "max-width:230px;margin:0 auto" });

    let angle = -Math.PI / 2;
    data.forEach((d, i) => {
      const frac = d.value / total;
      const a2 = angle + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = (rr, a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      const [x1, y1] = p(r, angle), [x2, y2] = p(r, a2);
      const [x3, y3] = p(inner, a2), [x4, y4] = p(inner, angle);
      const path = svgEl("path", {
        d: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`,
        fill: seriesVar(i, d),
        stroke: "var(--surface)", "stroke-width": 2, "stroke-linejoin": "round",
      });
      path.addEventListener("pointermove", (e) => {
        C.tipShow(e.clientX, e.clientY, {
          title: d.label,
          rows: [{ color: seriesVar(i, d), label: opts.valueLabel || "Time", value: `${opts.fmtVal ? opts.fmtVal(d.value) : d.value} · ${Math.round(frac * 100)}%` }],
        });
      });
      path.addEventListener("pointerleave", C.tipHide);
      svg.appendChild(path);
      angle = a2;
    });

    const centerV = svgEl("text", { x: cx, y: cy - 1, "text-anchor": "middle", "font-size": 17, "font-weight": 700, fill: "var(--ink)" });
    txt(centerV, opts.fmtVal ? opts.fmtVal(total) : String(total));
    const centerL = svgEl("text", { x: cx, y: cy + 15, "text-anchor": "middle", "font-size": 9.5, fill: "var(--ink-3)" });
    txt(centerL, opts.centerLabel || "total");
    svg.append(centerV, centerL);
    body.appendChild(svg);

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.style.justifyContent = "center";
    data.forEach((d, i) => {
      const item = document.createElement("span");
      item.className = "lg-item";
      const sw = document.createElement("span");
      sw.className = "lg-swatch";
      sw.style.background = seriesVar(i, d);
      const name = document.createElement("span");
      name.textContent = `${d.label} · ${Math.round((d.value / total) * 100)}%`;
      item.append(sw, name);
      legend.appendChild(item);
    });
    body.appendChild(legend);
  };

  /* ============================================================
     Line chart with crosshair (single series)
     data: [{label, value, tipTitle}]
     ============================================================ */
  C.line = function (body, data, opts) {
    opts = opts || {};
    if (!data.length) { C.emptyNote(body, opts.emptyMsg || "Nothing here yet"); return; }
    const W = 760, H = 200, padL = 34, padR = 12, padT = 12, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = Math.max(...data.map((d) => d.value), opts.minMax || 2);
    const ticks = niceTicks(maxV, 3).filter((v) => Number.isInteger(v) || !opts.integer);
    const yMax = ticks[ticks.length - 1];
    const x = (i) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = (v) => padT + plotH - (v / yMax) * plotH;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    ticks.forEach((tv) => {
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(tv), y2: y(tv), stroke: "var(--grid)", "stroke-width": 1 }));
      const t = svgEl("text", { x: padL - 6, y: y(tv) + 3.5, "text-anchor": "end", "font-size": 10, fill: "var(--ink-3)", style: "font-variant-numeric:tabular-nums" });
      txt(t, String(tv));
      svg.appendChild(t);
    });
    data.forEach((d, i) => {
      if (i % (opts.labelEvery || 5) === 0) {
        const t = svgEl("text", { x: x(i), y: H - 7, "text-anchor": "middle", "font-size": 10, fill: "var(--ink-3)" });
        txt(t, d.label);
        svg.appendChild(t);
      }
    });

    const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join("");
    // area wash
    svg.appendChild(svgEl("path", {
      d: `${linePath}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`,
      fill: "var(--series-1)", opacity: 0.09,
    }));
    svg.appendChild(svgEl("path", { d: linePath, fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));

    // end dot + end label (selective direct label)
    const last = data[data.length - 1];
    svg.appendChild(svgEl("circle", { cx: x(data.length - 1), cy: y(last.value), r: 4, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 }));

    // crosshair + hover
    const cross = svgEl("line", { y1: padT, y2: padT + plotH, stroke: "var(--hairline-2)", "stroke-width": 1, visibility: "hidden" });
    const dot = svgEl("circle", { r: 4.5, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
    svg.append(cross, dot);
    const overlay = svgEl("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" });
    overlay.addEventListener("pointermove", (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * W;
      const i = App.clamp(Math.round(((relX - padL) / plotW) * (data.length - 1)), 0, data.length - 1);
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(data[i].value));
      dot.setAttribute("visibility", "visible");
      C.tipShow(e.clientX, e.clientY, {
        title: data[i].tipTitle || data[i].label,
        rows: [{ color: "var(--series-1)", label: opts.valueLabel || "Value", value: opts.fmtVal ? opts.fmtVal(data[i].value) : data[i].value }],
      });
    });
    overlay.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      C.tipHide();
    });
    svg.appendChild(overlay);
    body.appendChild(svg);
  };

  /* ============================================================
     Scatter with identity line (estimated vs actual, minutes)
     data: [{x, y, label}]
     ============================================================ */
  C.scatter = function (body, data, opts) {
    opts = opts || {};
    if (!data.length) { C.emptyNote(body, opts.emptyMsg || "Nothing here yet"); return; }
    const W = 720, H = 240, padL = 44, padR = 16, padT = 12, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = Math.max(...data.map((d) => Math.max(d.x, d.y)), 30);
    const ticks = niceTicks(maxV);
    const vMax = ticks[ticks.length - 1];
    const x = (v) => padL + (v / vMax) * plotW;
    const y = (v) => padT + plotH - (v / vMax) * plotH;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    ticks.forEach((tv) => {
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(tv), y2: y(tv), stroke: "var(--grid)", "stroke-width": 1 }));
      const ty = svgEl("text", { x: padL - 6, y: y(tv) + 3.5, "text-anchor": "end", "font-size": 10, fill: "var(--ink-3)" });
      txt(ty, App.fmtMinutes(tv));
      svg.appendChild(ty);
      const tx = svgEl("text", { x: x(tv), y: H - 12, "text-anchor": "middle", "font-size": 10, fill: "var(--ink-3)" });
      txt(tx, App.fmtMinutes(tv));
      svg.appendChild(tx);
    });
    // identity line: on-estimate
    svg.appendChild(svgEl("line", { x1: x(0), y1: y(0), x2: x(vMax), y2: y(vMax), stroke: "var(--hairline-2)", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
    const idLab = svgEl("text", { x: x(vMax * 0.86), y: y(vMax * 0.86) - 8, "font-size": 9.5, fill: "var(--ink-3)", "text-anchor": "middle", transform: `rotate(-38 ${x(vMax * 0.86)} ${y(vMax * 0.86) - 8})` });
    txt(idLab, "on estimate");
    svg.appendChild(idLab);

    const axX = svgEl("text", { x: padL + plotW / 2, y: H - 1, "text-anchor": "middle", "font-size": 9.5, fill: "var(--ink-3)" });
    txt(axX, "estimated →");
    svg.appendChild(axX);

    data.forEach((d) => {
      svg.appendChild(svgEl("circle", { cx: x(d.x), cy: y(d.y), r: 4.5, fill: "var(--series-1)", "fill-opacity": 0.8, stroke: "var(--surface)", "stroke-width": 2 }));
      const hit = svgEl("circle", { cx: x(d.x), cy: y(d.y), r: 13, fill: "transparent" });
      hit.addEventListener("pointermove", (e) => {
        C.tipShow(e.clientX, e.clientY, {
          title: d.label,
          rows: [
            { color: "transparent", label: "Estimated", value: App.fmtMinutes(d.x) },
            { color: "var(--series-1)", label: "Actual", value: App.fmtMinutes(d.y) },
          ],
        });
      });
      hit.addEventListener("pointerleave", C.tipHide);
      svg.appendChild(hit);
    });
    body.appendChild(svg);
  };
})();
