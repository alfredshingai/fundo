// StudyForge frontend — vanilla JS SPA
import { sfx, speak, stopSpeaking, setTtsEnabled } from "./sounds.js";

// ---------- tiny helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("#toast-root").appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function confetti() {
  const root = $("#confetti-root");
  const emojis = ["🎉", "✨", "⭐", "🔥", "🏆", "💜"];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement("span");
    s.className = "confetti";
    s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    s.style.left = Math.random() * 100 + "vw";
    s.style.animationDuration = 2 + Math.random() * 2 + "s";
    s.style.animationDelay = Math.random() * 0.6 + "s";
    root.appendChild(s);
    setTimeout(() => s.remove(), 5200);
  }
}

function celebrate(progress) {
  if (!progress) return;
  if (progress.leveledUp) {
    sfx.levelUp();
    confetti();
    const pop = document.createElement("div");
    pop.className = "levelup-pop";
    pop.innerHTML = `<div class="levelup-inner">
      <div class="trophy">🏆</div>
      <h2>Level ${progress.level}!</h2>
      <p class="muted">You leveled up from ${progress.levelBefore} → ${progress.level}. Keep going!</p>
      <button class="btn" onclick="this.closest('.levelup-pop').remove()">Nice!</button>
    </div>`;
    pop.addEventListener("click", (e) => { if (e.target === pop) pop.remove(); });
    $("#modal-root").appendChild(pop);
  } else if (progress.streakIncreased) {
    sfx.streak();
    toast(`🔥 ${progress.streak}-day study streak!`, "good");
  }
}

function updateHud(p) {
  if (!p) return;
  $("#hud-level").textContent = `Lv ${p.level}`;
  $("#hud-xp").textContent = `${p.xp} XP`;
  $("#hud-xp-fill").style.width = Math.min(100, (p.into / p.span) * 100) + "%";
  $("#hud-streak").textContent = `🔥 Streak: ${p.streakCount} day${p.streakCount === 1 ? "" : "s"}`;
}

async function refreshHud() {
  try { updateHud(await api("progress")); } catch { /* ignore */ }
}

// ---------- pseudo-LaTeX repair: convert raw math-ish text to real LaTeX ----------
// Older AI content wrote equations as plain text (y_{it} = β_0 + ε_it). Detect
// math-looking token runs and wrap them in \( ... \) so KaTeX typesets them.
// Code spans (`...`) are protected beforehand; already-real LaTeX is left alone.
const GLYPH_MAP = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ϵ: "\\epsilon",
  ζ: "\\zeta", η: "\\eta", θ: "\\theta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu",
  ν: "\\nu", ξ: "\\xi", π: "\\pi", ρ: "\\rho", σ: "\\sigma", τ: "\\tau", υ: "\\upsilon",
  φ: "\\phi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega", Γ: "\\Gamma", Δ: "\\Delta",
  Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Φ: "\\Phi", Ψ: "\\Psi",
  Ω: "\\Omega",
  "∂": "\\partial", "∇": "\\nabla", "∞": "\\infty", "√": "\\sqrt", "∑": "\\sum", "∏": "\\prod",
  "∫": "\\int", "≈": "\\approx", "≠": "\\neq", "≤": "\\le", "≥": "\\ge", "±": "\\pm", "×": "\\times",
  "÷": "\\div", "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq", "∪": "\\cup", "∩": "\\cap",
  "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow",
  "⇒": "\\implies", "⇐": "\\impliedby", "⇔": "\\iff", "∝": "\\propto", "⊥": "\\perp", "∥": "\\parallel",
  "−": "-", "–": "-", "·": "\\cdot", "⋅": "\\cdot", "∼": "\\sim", "~": "\\sim", "°": "^{\\circ}", "′": "'",
  "²": "^{2}", "³": "^{3}", "¹": "^{1}",
};
const SUBS = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "ᵢ": "i", "ⱼ": "j", "ᵣ": "r", "ᵤ": "u", "ᵥ": "v", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t" };
const SUPS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ⁿ": "n", "ⁱ": "i", "⁺": "+", "⁻": "-" };

const MATHISH = /[\u0370-\u03FF\u1F00-\u1FFF\u2080-\u209C\u2070-\u207F\u00B2\u00B3\u00B9\u00B0\u1D62\u2C7C]/;

function classifyMathToken(core) {
  if (core === "") return "p";
  if (/^\\[a-zA-Z]+/.test(core)) return "m"; // already a LaTeX command
  if (/[_^]\{/.test(core)) return "ms"; // braced sub/sup
  if (MATHISH.test(core)) return "ms"; // Greek, unicode sub/sup, °
  if (/[A-Za-z0-9')\]][_^][A-Za-z0-9'{(]/.test(core)) return "mw"; // embedded sub/sup, e.g. Y_ij
  if (/^[0-9]+([.,][0-9]+)*%?$/.test(core)) return "n";
  if (/^[=≤≥≠≈<>±×÷→←↔⇒⇐⇔∈∉∝⊥∥−+*/|~·\-]$/.test(core)) return "op";
  if (/^[|()\[\]{}]+$/.test(core)) return "p";
  if (/^,$/.test(core)) return "c";
  return "w";
}

function toLatex(t) {
  // unicode subscript/superscript runs (incl. modifier letters like ᵢ ⁱ)
  t = t.replace(/[\u2080-\u209C]+|[\u1D62\u1D63\u1D64\u1D65\u2C7C\u2C7D]/g, (m) => "_{" + [...m].map((c) => SUBS[c] ?? "").join("") + "}");
  t = t.replace(/[\u2070-\u207F]+|[\u00B2\u00B3\u00B9\u2071]/g, (m) => "^{" + [...m].map((c) => SUPS[c] ?? "").join("") + "}");
  for (const [k, v] of Object.entries(GLYPH_MAP)) t = t.split(k).join(v);
  t = t.replace(/’/g, "'");
  // brace multi-char unbraced subscripts: _it, _i,t-1 → _{it}, _{i,t-1}
  // variable-name subscripts written tight: tij → t_{ij}, Yij → Y_{ij}, b1i → b_{1i}
  // (only inside math groups; common words are protected)
  const STOP = new Set(["var", "cov", "log", "exp", "max", "min", "sin", "cos", "tan", "det", "dim", "arg", "mod", "gcd", "lcm", "sd", "aic", "bic", "ols", "gmm", "iid", "and", "for", "the", "are", "not", "use", "its", "let", "where", "with"]);
  t = t.replace(/(^|[^a-zA-Z\\{])([a-z]{2,4})(?![a-zA-Z_}])/g, (m, p, w) => STOP.has(w) ? m : p + w[0] + "_{" + w.slice(1) + "}");
  t = t.replace(/(^|[^a-zA-Z\\{])([A-Z])([a-z]{2,3})(?![a-zA-Z_}])/g, (m, p, a, b) => p + a + "_{" + b + "}");
  t = t.replace(/(?<!\{)_([A-Za-z0-9']{2,}(?:[,+\-][A-Za-z0-9',+\-]*)*)/g, (_m, g) => "_{" + g + "}");
  t = t.replace(/_(?!\{)([A-Za-z0-9'])/g, (_m, c) => "_{" + c + "}");
  t = t.replace(/\^(?!\{)([A-Za-z0-9']{2,})/g, "^{$1}");
  t = t.replace(/\^(?!\{)([A-Za-z0-9'])/g, "^{$1}");
  // collapse chained sub/sups produced by adjacent unicode runs: b_{1}_{i} → b_{1i}
  t = t.replace(/\}_\{/g, "");
  t = t.replace(/\}\^\{/g, "");
  // greek immediately followed by alphanumerics = subscripted index: β1i, β1Ei → \beta_{1i}
  t = t.replace(/\\(alpha|beta|gamma|delta|varepsilon|epsilon|zeta|eta|theta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|chi|psi|omega)([0-9][A-Za-z0-9]*)\b/g, "\\$1_{$2}");
  // ascii variable+digit+index runs inside math: b1i, y11 → b_{1i}, y_{11}
  t = t.replace(/(?<!\\)([a-zA-Z])([0-9]{1,2}[a-z]{1,2})\b/g, "$1_{$2}");
  // keep Greek commands from fusing with a following letter: \rhoy → \rho y
  t = t.replace(/(\\(?:alpha|beta|gamma|delta|varepsilon|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|partial|nabla))(?=[a-zA-Z])/g, "$1 ");
  return t;
}

const RELATIONS = "→←↔⇒⇐⇔≤≥≠≈±×÷∈∉∝⊥∥";
function pseudoMath(s) {
  if (!s || !new RegExp(`[_^°]|[\\u0370-\\u03FF\\u1F00-\\u1FFF\\u2080-\\u209C\\u2070-\\u207F\\u00B2\\u00B3\\u00B9\\u1D62\\u2C7C${RELATIONS}]`).test(s)) return s;
  // leave already-real LaTeX regions (\(...\), \[...\], $$...$$) and inline code untouched
  // NOTE: the backslashes must be part of the match — bare (parenthesis) spans are NOT latex
  const chunks = s.split(/(\\\(.*?\\\)|\\\[.*?\\\]|\$\$.*?\$\$|`[^`]*`)/gs);
  return chunks.map((chunk, idx) => {
    if (idx % 2 === 1) {
      // code span: convert to math only when it clearly holds an equation
      const m = /^`([^`]*)`$/.exec(chunk);
      if (m && /[\u0370-\u03FF\u1F00-\u1FFF\u2080-\u209C\u2070-\u207F]/.test(m[1])) {
        return "\\(" + toLatex(m[1]) + "\\)";
      }
      return chunk;
    }
    // keep markdown structure markers ("> ") out of math groups
    const lead = chunk.match(/^(?:&gt;|>)\s?/);
    const body = lead ? chunk.slice(lead[0].length) : chunk;
    const done = (x) => (lead ? lead[0] + x : x);
    if (!new RegExp(`[_^°]|[\\u0370-\\u03FF\\u1F00-\\u1FFF\\u2080-\\u209C\\u2070-\\u207F\\u00B2\\u00B3\\u00B9\\u1D62\\u2C7C${RELATIONS}]`).test(body)) return chunk;
    const raw = body.split(/(\s+)/);
    const out = [];
    let grp = null;
    const flush = () => {
      if (!grp) return;
      const joined = grp.parts.join("");
      const strong = grp.parts.some((p) => ["ms", "m", "mw"].includes(clsOf(p)));
      const mathish = grp.parts.filter((p) => ["ms", "m", "mw", "n"].includes(clsOf(p))).length;
      const hasOp = grp.parts.some((p) => clsOf(p) === "op");
      const hasRelation = grp.parts.some((p) => new RegExp(`[${RELATIONS}]`).test(p));
      if (strong || mathish >= 2 || (hasOp && mathish >= 1) || hasRelation) {
        while (grp.parts.length && clsOf(grp.parts[grp.parts.length - 1]) === "op") grp.parts.pop();
        // keep boundary whitespace out of the math so prose spacing survives
        let tail = "";
        while (grp.parts.length && /^\s+$/.test(grp.parts[grp.parts.length - 1])) tail = grp.parts.pop() + tail;
        let head = "";
        while (grp.parts.length && /^\s+$/.test(grp.parts[0])) head += grp.parts.shift();
        if (head) out.push(head);
        out.push("\\(" + toLatex(grp.parts.join("")) + "\\)");
        if (tail) out.push(tail);
      } else out.push(joined);
      grp = null;
    };
    const clsOf = (tok) => classifyMathToken(String(tok).replace(/^[*_~]+|[*_~]+$/g, ""));
    const nextSig = (from) => {
      for (let j = from + 1; j < raw.length; j++) {
        if (j % 2 === 1) continue;
        const t2 = raw[j];
        if (t2 === undefined || /^\s*$/.test(t2)) continue;
        return clsOf(t2);
      }
      return "w";
    };
    for (let i = 0; i < raw.length; i++) {
      const tok = raw[i];
      if (tok === undefined) continue;
      if (/^\s+$/.test(tok)) { if (grp) grp.parts.push(tok); else out.push(tok); continue; }
      const trail = (tok.match(/[*_~]+$/) || [""])[0];
      const core = trail ? tok.slice(0, tok.length - trail.length) : tok;
      const cls = clsOf(core);
      if (grp) {
        if (cls === "w" || cls === "c" || core === "|") { flush(); out.push(core); if (trail) out.push(trail); continue; }
        grp.parts.push(core);
        if (trail) { flush(); out.push(trail); }
      } else {
        const starter = cls === "ms" || cls === "m" || cls === "mw" ||
          (cls === "n" && ["op", "ms", "m", "mw"].includes(nextSig(i))) ||
          (cls === "op" && core !== "|" && (["n", "ms", "m", "mw"].includes(nextSig(i)) ||
            (out.length >= 2 && classifyMathToken(String(out[out.length - 2] ?? "").replace(/^\\\(|\\\)$/g, "")) === "n"))) ||
          (cls === "p" && core !== "|" && ["ms", "m", "mw", "n", "op"].includes(nextSig(i)));
        if (starter && !trail) grp = { parts: [core] };
        else out.push(core + trail);
      }
    }
    flush();
    return done(out.join(""));
  }).join("");
}

// esc + pseudo-LaTeX repair — use for user-visible AI text surfaces
const escM = (s) => pseudoMath(esc(s));

// ---------- markdown-lite renderer for notes (tables, quotes, rules, math) ----------
function renderNotes(md) {
  const lines = esc(md).split("\n").map(pseudoMath);
  let html = "", inList = false, inCode = false, i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) { html += "</code></pre>"; inCode = false; }
      else { html += "<pre><code>"; inCode = true; }
      i++; continue;
    }
    if (inCode) { html += line + "\n"; i++; continue; }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += "<hr>"; i++; continue;
    }
    // display-math blocks: \[ ... \] or $$ ... $$ — may span several lines.
    // Must be emitted as ONE element, or KaTeX auto-render can't match the delimiters.
    if (/^\s*\\\[/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const buf = [line];
      const single = /\\]\s*$/.test(line);
      i++;
      if (!single) { while (i < lines.length && !/\\]\s*$/.test(lines[i])) { buf.push(lines[i]); i++; } if (i < lines.length) { buf.push(lines[i]); i++; } }
      html += `<div class="math-block">${buf.join("\n")}</div>`;
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const buf = [line];
      const single = (line.match(/\$\$/g) || []).length >= 2;
      i++;
      if (!single) { while (i < lines.length && !/\$\$/.test(lines[i])) { buf.push(lines[i]); i++; } if (i < lines.length) { buf.push(lines[i]); i++; } }
      html += `<div class="math-block">${buf.join("\n")}</div>`;
      continue;
    }
    if (/^(&gt;|>)\s?/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const quote = [];
      while (i < lines.length && /^(&gt;|>)\s?/.test(lines[i])) { quote.push(lines[i].replace(/^(&gt;|>)\s?/, "")); i++; }
      html += `<blockquote>${inline(quote.join(" "))}</blockquote>`;
      continue;
    }
    // markdown table: header row + |---|---| separator
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      if (inList) { html += "</ul>"; inList = false; }
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      html += '<div class="table-wrap"><table><thead><tr>' +
        head.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table></div>";
      continue;
    }
    const li = line.match(/^\s*[-*•]\s+(.*)/);
    if (li) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      i++; continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.startsWith("### ")) html += `<h3>${inline(line.slice(4))}</h3>`;
    else if (line.startsWith("## ")) html += `<h2>${inline(line.slice(3))}</h2>`;
    else if (line.startsWith("# ")) html += `<h2>${inline(line.slice(2))}</h2>`;
    else if (line.trim() === "") html += "";
    else html += `<p>${inline(line)}</p>`;
    i++;
  }
  if (inList) html += "</ul>";
  if (inCode) html += "</code></pre>";
  return html;

  function splitRow(row) {
    return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  }
  function inline(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }
}

// ---------- LaTeX math typesetting (KaTeX auto-render) ----------
const MATH_DELIMS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];
// Shims for LaTeX commands from packages KaTeX doesn't ship (siunitx's \SI/\si,
// bm's \bm, misc common ones). mhchem (\ce) ships as a real KaTeX package.
const SHIM_MACROS = {
  "\\SI": "\\mathrm{#1}\\;\\mathrm{#2}",
  "\\si": "\\mathrm{#1}",
  "\\qty": "\\mathrm{#1}\\;\\mathrm{#2}",
  "\\unit": "\\mathrm{#1}",
  "\\bm": "\\boldsymbol{#1}",
  "\\degree": "^\\circ",
  "\\degreeCelsius": "^\\circ\\mathrm{C}",
  "\u2103": "^\\circ\\mathrm{C}",
  "\\R": "\\mathbb{R}",
  "\\E": "\\mathbb{E}",
  "\\Var": "\\mathrm{Var}",
  "\\Cov": "\\mathrm{Cov}",
  "\\tr": "\\mathrm{tr}",
  "\\eps": "\\varepsilon",
  "\\argmax": "\\operatorname*{arg\\,max}",
  "\\argmin": "\\operatorname*{arg\\,min}",
};

function typesetMath(root) {
  if (!root) return;
  root.querySelectorAll(".katex-error").forEach((el) => el.remove());
  if (!window.katex || !window.renderMathInElement) { root.classList.add("math-raw"); return; }
  try {
    window.renderMathInElement(root, {
      delimiters: MATH_DELIMS,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      throwOnError: false,
      strict: "ignore",
      macros: SHIM_MACROS,
    });
    root.classList.remove("math-raw");
  } catch { root.classList.add("math-raw"); }
}

// auto-typeset anything inserted into the page (flashcard flips, quiz reveals,
// checkpoint results, regenerated sections …) — debounced, self-converging
let mathTimer = null, mathRunning = false;
const mathObserver = new MutationObserver(() => {
  if (mathRunning) return;
  clearTimeout(mathTimer);
  mathTimer = setTimeout(() => {
    const main = $("#main");
    if (!main) return;
    mathRunning = true;
    try { typesetMath(main); } finally { mathRunning = false; }
  }, 30);
});
mathObserver.observe($("#main"), { childList: true, subtree: true, characterData: true });

// ---------- routing ----------
const routes = { dashboard: renderDashboard, upload: renderUpload, documents: renderDocuments, document: renderDocument, settings: renderSettings, course: renderCourse };

function nav(route, params) {
  sfx.click();
  history.pushState({ route, params }, "", `#${route}${params && params.id ? "/" + params.id : ""}`);
  render(route, params);
}

async function render(route, params = {}) {
  stopSpeaking();
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  const main = $("#main");
  main.innerHTML = `<div class="muted" style="padding:40px">Loading…</div>`;
  try {
    await routes[route](main, params);
  } catch (e) {
    main.innerHTML = `<div class="card"><h3>⚠️ ${esc(e.message)}</h3></div>`;
  }
  await refreshHud();
}

window.addEventListener("popstate", (e) => {
  const r = (e.state && e.state.route) || "dashboard";
  render(r, (e.state && e.state.params) || {});
});

// Support direct hash links (#/document/<id>, #upload, ...)
window.addEventListener("hashchange", () => {
  const h = location.hash.replace(/^#\//, "").replace(/^#/, "");
  if (!h) return;
  const [route, id] = h.split("/");
  if (routes[route]) render(route, id ? { id } : {});
});

$$(".nav-btn").forEach((b) => b.addEventListener("click", () => nav(b.dataset.route)));

// ---------- dashboard ----------
async function renderDashboard(main) {
  const [prog, docs, cfgState] = await Promise.all([api("progress"), api("documents"), api("ai/config")]);
  const list = docs.documents;
  const totalCards = list.reduce((a, d) => a + d.flashcard_count, 0);
  const dueCards = list.reduce((a, d) => a + d.due_count, 0);

  main.innerHTML = `
    <h1>Welcome back 👋</h1>
    <p class="sub">Turn your PDFs, DOCX and text files into notes, flashcards and quizzes — with XP, streaks and reward sounds.</p>
    ${!cfgState.hasKey ? `<div class="card" style="border-color:var(--warn)"><h3>🔑 One setup step left</h3><p class="muted" style="margin:4px 0 12px">Add an API key so AI can turn documents into study material. Free options: OpenCode Zen or OpenRouter ":free" models.</p><button class="btn" id="setup-ai">Open AI Settings</button></div>` : ""}

    <div class="stat-row">
      <div class="stat"><div class="num">${prog.level}</div><div class="lbl">Level</div></div>
      <div class="stat"><div class="num">${prog.xp}</div><div class="lbl">Total XP</div></div>
      <div class="stat"><div class="num">${prog.streakCount} 🔥</div><div class="lbl">Day streak</div></div>
      <div class="stat"><div class="num">${dueCards}</div><div class="lbl">Cards due for review</div></div>
    </div>

    <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, (prog.into / prog.span) * 100)}%"></div></div>
    <p class="muted small">${prog.into} / ${prog.span} XP toward level ${prog.level + 1} · +${prog.xpPerCorrect} XP per correct answer</p>

    <h2>Quick actions</h2>
    <div class="card" style="display:flex;gap:12px;flex-wrap:wrap">
      <button class="btn" id="qa-upload">⬆️ Upload a document</button>
      ${dueCards > 0 ? `<button class="btn secondary" id="qa-review">🎯 Review ${dueCards} due card${dueCards === 1 ? "" : "s"}</button>` : ""}
      <button class="btn secondary" id="qa-docs">📚 My documents</button>
    </div>

    <h2>Recent documents</h2>
    ${list.length === 0
      ? `<div class="card muted">No documents yet. <a href="#upload" id="go-upload">Upload your first one</a> — PDF, DOCX, TXT or MD.</div>`
      : `<div class="grid">${list.slice(0, 6).map(docCardHtml).join("")}</div>`}
  `;

  const setupBtn = $("#setup-ai");
  if (setupBtn) setupBtn.onclick = () => nav("settings");

  $("#qa-upload").onclick = () => nav("upload");
  $("#qa-docs").onclick = () => nav("documents");
  const reviewBtn = $("#qa-review");
  if (reviewBtn) reviewBtn.onclick = () => startFirstDueReview();
  const go = $("#go-upload");
  if (go) go.onclick = (e) => { e.preventDefault(); nav("upload"); };
  bindDocCards(main);
}

function docCardHtml(d) {
  return `<div class="card doc-card" data-id="${d.id}" style="cursor:pointer">
    <h3>${esc(d.title)}</h3>
    <div style="margin:6px 0 10px">
      <span class="badge">${esc(d.file_type.replace(".", "").toUpperCase())}</span>
      <span class="badge">${d.flashcard_count} cards</span>
      <span class="badge">${d.quiz_count} quiz Qs</span>
      ${d.due_count > 0 ? `<span class="badge warn">${d.due_count} due</span>` : ""}
    </div>
    <div class="muted small">${d.char_count.toLocaleString()} chars · ${d.page_count ? d.page_count + " pages · " : ""}${new Date(d.created_at + "Z").toLocaleDateString()}</div>
  </div>`;
}

function bindDocCards(root) {
  $$(".doc-card", root).forEach((el) =>
    el.addEventListener("click", () => nav("document", { id: el.dataset.id })));
}

async function startFirstDueReview() {
  const docs = await api("documents");
  const due = docs.documents.find((d) => d.due_count > 0);
  if (due) nav("document", { id: due.id, tab: "review" });
}

// ---------- upload ----------
async function renderUpload(main) {
  main.innerHTML = `
    <h1>Upload a document</h1>
    <p class="sub">PDF, DOCX, TXT or MD only — no video or audio, ever.</p>
    <div class="dropzone" id="dropzone">
      <div class="big">📄</div>
      <div><strong>Drop a file here</strong> or click to browse</div>
      <div class="small" style="margin-top:6px">.pdf &nbsp;·&nbsp; .docx &nbsp;·&nbsp; .txt &nbsp;·&nbsp; .md &nbsp;—&nbsp; max 30 MB</div>
      <input type="file" id="file-input" accept=".pdf,.docx,.txt,.md" hidden />
    </div>
    <div id="upload-progress" style="display:none;margin-top:18px" class="card">
      <h3 id="up-title">Processing…</h3>
      <div class="progress-track"><div class="progress-fill" id="up-fill" style="width:8%"></div></div>
      <p class="muted small" id="up-status">Extracting text from your document…</p>
    </div>
  `;

  const dz = $("#dropzone");
  const input = $("#file-input");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => { if (input.files.length) handleUpload(input.files[0]); });

  async function handleUpload(file) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const allowed = [".pdf", ".docx", ".txt", ".md"];
    const media = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".m4a", ".ogg", ".flac"];
    if (!allowed.includes(ext)) {
      sfx.wrong();
      toast(media.includes(ext)
        ? "🚫 No video or audio — StudyForge only reads PDF, DOCX, TXT and MD."
        : `🚫 "${ext || "unknown"}" files aren't supported. Use PDF, DOCX, TXT or MD.`, "err");
      return;
    }
    if (file.size > 30 * 1024 * 1024) { sfx.wrong(); toast("🚫 File too large (max 30 MB).", "err"); return; }

    const fd = new FormData();
    fd.append("file", file);
    const prog = $("#upload-progress");
    const fill = $("#up-fill");
    const status = $("#up-status");
    $("#up-title").textContent = `Processing “${file.name}”…`;
    prog.style.display = "block";
    status.textContent = "Uploading and extracting text…";
    fill.style.width = "25%";

    // animate the bar while waiting (generation can take a minute on free models)
    let fake = 25;
    const timer = setInterval(() => { fake = Math.min(fake + 2, 88); fill.style.width = fake + "%"; }, 1200);

    try {
      sfx.upload();
      const res = await api("documents/upload", { method: "POST", body: fd });
      clearInterval(timer);
      fill.style.width = "100%";
      status.textContent = "Done!";
      if (res.warning) {
        toast("📄 Document extracted and saved — but AI generation failed. See AI Settings.", "err");
      } else {
        sfx.complete();
        confetti();
        toast(`✅ Notes, ${res.flashcards} flashcards and ${res.quiz} quiz questions ready!`, "good");
      }
      setTimeout(() => nav("document", { id: res.documentId }), 900);
    } catch (e) {
      clearInterval(timer);
      prog.style.display = "none";
      sfx.wrong();
      toast(`❌ ${e.message}`, "err");
    }
  }
}

// ---------- documents list ----------
async function renderDocuments(main) {
  const { documents } = await api("documents");
  main.innerHTML = `
    <h1>My Documents</h1>
    <p class="sub">Everything you've uploaded, with generated study material.</p>
    ${documents.length === 0
      ? `<div class="card muted">Nothing here yet — <a href="#upload" id="go-upload">upload something</a>!</div>`
      : `<div class="grid">${documents.map(docCardHtml).join("")}</div>`}
  `;
  const go = $("#go-upload");
  if (go) go.onclick = (e) => { e.preventDefault(); nav("upload"); };
  bindDocCards(main);
}

// ---------- single document ----------
async function renderDocument(main, params) {
  const data = await api(`documents/${params.id}`);
  const doc = data.document;
  const tab = params.tab || "notes";

  main.innerHTML = `
    <button class="btn secondary small" id="back">← All documents</button>
    <h1 style="margin-top:14px">${esc(doc.title)}</h1>
    <p class="sub">
      <span class="badge">${esc(doc.file_type.replace(".", "").toUpperCase())}</span>
      ${doc.page_count ? `<span class="badge">${doc.page_count} pages</span>` : ""}
      <span class="badge">${doc.char_count.toLocaleString()} chars</span>
      <span class="badge ok">${data.flashcards.length} flashcards</span>
      <span class="badge ok">${data.quiz.length} quiz questions</span>
    </p>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn" id="tab-course">🎓 Open course</button>
      <button class="btn secondary" id="tab-review">🎯 Review flashcards</button>
      <button class="btn secondary" id="tab-quiz">📝 Take quiz</button>
      <button class="btn secondary" id="tab-notes">📖 Notes</button>
      <button class="btn secondary" id="regen">🔄 Regenerate with AI</button>
      <button class="btn danger" id="del">🗑 Delete</button>
    </div>
    <div id="doc-content"></div>
  `;

  $("#back").onclick = () => nav("documents");
  $("#tab-notes").onclick = () => showNotes();
  $("#tab-review").onclick = () => showReview();
  $("#tab-quiz").onclick = () => showQuiz();
  $("#tab-course").onclick = async () => {
    toast("🎓 Preparing your course…");
    try {
      const r = await api("courses/create", { method: "POST", body: { documentId: params.id } });
      nav("course", { id: r.courseId });
    } catch (e) { sfx.wrong(); toast(`❌ ${e.message}`, "err"); }
  };
  $("#regen").onclick = async () => {
    if (!confirm("Regenerate notes, flashcards and quiz with AI? Current ones will be replaced.")) return;
    toast("🔄 Regenerating… this can take a minute.");
    try {
      const r = await api(`documents/${params.id}/regenerate`, { method: "POST" });
      sfx.complete();
      toast(`✅ New material: ${r.flashcards} cards, ${r.quiz} quiz questions`, "good");
      render("document", { id: params.id });
    } catch (e) { sfx.wrong(); toast(`❌ ${e.message}`, "err"); }
  };
  $("#del").onclick = async () => {
    if (!confirm(`Delete "${doc.title}" and all its study material?`)) return;
    await api(`documents/${params.id}/delete`, { method: "POST" });
    toast("Deleted.");
    nav("documents");
  };

  const content = $("#doc-content");
  if (tab === "review") showReview();
  else if (tab === "quiz") showQuiz();
  else showNotes();

  function showNotes() {
    if (!data.notes) { content.innerHTML = `<div class="card muted">No notes generated yet.</div>`; return; }
    content.innerHTML = `
      <div class="card notes-body">${renderNotes(data.notes.content)}</div>
      <p class="muted small">Generated by ${esc(data.notes.model)} · ${new Date(data.notes.updated_at + "Z").toLocaleString()} · always double-check against the original document.</p>
    `;
  }

  // ----- flashcard review with TTS -----
  let keyHandler = null;
  function showReview() {
    const cards = data.flashcards;
    if (!cards.length) { content.innerHTML = `<div class="card muted">No flashcards yet.</div>`; return; }

    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    let i = 0, flipped = false;
    let sessionCorrect = 0, sessionTotal = 0;
    let ttsOn = localStorage.getItem("sf-tts") !== "off";

    content.innerHTML = `
      <div class="card" style="max-width:680px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span class="muted small" id="rev-progress">Card 1 / ${cards.length}</span>
          <label class="small" style="cursor:pointer;user-select:none">
            <input type="checkbox" id="tts-toggle" ${ttsOn ? "checked" : ""} style="margin-right:6px" />
            🔊 Read cards aloud
          </label>
        </div>
        <div class="flash-stage">
          <div class="flash-card" id="flashcard">
            <div class="flash-face front" id="flash-front"></div>
            <div class="flash-face back" id="flash-back"></div>
            <div class="hint">click card or press Space to flip</div>
          </div>
        </div>
        <div class="grade-row" id="grade-row" style="visibility:hidden">
          <button class="grade-btn again" data-g="again">😐 Again</button>
          <button class="grade-btn hard" data-g="hard">😅 Hard</button>
          <button class="grade-btn good" data-g="good">🙂 Good</button>
          <button class="grade-btn easy" data-g="easy">😎 Easy</button>
        </div>
        <p class="muted small" style="text-align:center;margin-top:10px">1..4 keys grade · XP: again +2 · hard +6 · good +10 · easy +12</p>
      </div>
    `;

    const cardEl = $("#flashcard");
    const frontEl = $("#flash-front");
    const backEl = $("#flash-back");
    const gradeRow = $("#grade-row");

    setTtsEnabled(ttsOn);
    $("#tts-toggle").addEventListener("change", (e) => {
      ttsOn = e.target.checked;
      localStorage.setItem("sf-tts", ttsOn ? "on" : "off");
      setTtsEnabled(ttsOn);
      if (ttsOn) speakCurrentSide();
    });

    function show() {
      flipped = false;
      cardEl.classList.remove("flipped");
      frontEl.innerHTML = `<div>${escM(cards[i].front)}</div>`;
      backEl.innerHTML = `<div>${escM(cards[i].back)}</div>`;
      gradeRow.style.visibility = "hidden";
      $("#rev-progress").textContent = `Card ${i + 1} / ${cards.length}`;
      if (ttsOn) setTimeout(speakCurrentSide, 150);
    }

    function speakCurrentSide() {
      speak(flipped ? cards[i].back : cards[i].front);
    }

    function flip() {
      if (flipped) return;
      flipped = true;
      sfx.flip();
      cardEl.classList.add("flipped");
      gradeRow.style.visibility = "visible";
      if (ttsOn) setTimeout(() => speak(cards[i].back), 250);
    }

    cardEl.addEventListener("click", flip);

    async function grade(g) {
      if (!flipped) { flip(); return; }
      const res = await api(`review/${cards[i].id}`, { method: "POST", body: { grade: g } });
      sessionTotal++;
      if (g === "good" || g === "easy") { sessionCorrect++; sfx.correct(); } else if (g === "hard") sfx.click(); else sfx.wrong();
      updateHud(res.progress);
      celebrate(res.progress);
      i++;
      if (i >= cards.length) return finishSession();
      show();
    }

    function finishSession() {
      sfx.complete();
      confetti();
      content.innerHTML = `
        <div class="card" style="max-width:520px;margin:0 auto;text-align:center;padding:40px">
          <div class="mascot">🎉</div>
          <h2>Session complete!</h2>
          <p class="muted">${sessionCorrect} of ${sessionTotal} cards felt easy. Come back when more are due.</p>
          <button class="btn" id="done-btn">Back to document</button>
        </div>`;
      $("#done-btn").onclick = () => render("document", { id: params.id });
    }

    gradeRow.addEventListener("click", (e) => {
      const b = e.target.closest(".grade-btn");
      if (b) grade(b.dataset.g);
    });

    keyHandler = (e) => {
      if (!content.isConnected) return;
      if (e.code === "Space") { e.preventDefault(); flip(); }
      else if (e.key >= "1" && e.key <= "4") {
        const grades = ["again", "hard", "good", "easy"];
        grade(grades[Number(e.key) - 1]);
      }
    };
    document.addEventListener("keydown", keyHandler);

    show();
  }

  // ----- quiz -----
  function showQuiz() {
    const questions = data.quiz;
    if (!questions.length) { content.innerHTML = `<div class="card muted">No quiz questions yet.</div>`; return; }

    const answers = new Array(questions.length).fill(-1);
    content.innerHTML = `
      <div class="card">
        <h3>📝 Quiz — ${questions.length} questions</h3>
        <p class="muted small">+${10} XP per correct answer · perfect score bonus +25 XP</p>
        ${questions.map((q, qi) => `
          <div class="quiz-q" data-qi="${qi}">
            <div class="q-text">${qi + 1}. ${escM(q.question)}</div>
            ${q.options.map((opt, oi) => `<button class="opt" data-oi="${oi}">${String.fromCharCode(65 + oi)}. ${escM(opt)}</button>`).join("")}
            <div class="quiz-explain" style="display:none"></div>
          </div>`).join("")}
        <div style="text-align:center;margin-top:18px">
          <button class="btn" id="submit-quiz" disabled>Submit answers</button>
        </div>
      </div>
    `;

    $$(".quiz-q", content).forEach((qEl) => {
      const qi = Number(qEl.dataset.qi);
      $$(".opt", qEl).forEach((optEl) => {
        optEl.addEventListener("click", () => {
          $$(".opt", qEl).forEach((o) => o.classList.remove("sel"));
          optEl.classList.add("sel");
          answers[qi] = Number(optEl.dataset.oi);
          $("#submit-quiz").disabled = answers.some((a) => a === -1);
          sfx.click();
        });
      });
    });

    $("#submit-quiz").onclick = async () => {
      const res = await api(`quiz/${params.id}/submit`, { method: "POST", body: { answers } });
      $$(".quiz-q", content).forEach((qEl, qi) => {
        const r = res.results[qi];
        $$(".opt", qEl).forEach((optEl) => {
          const oi = Number(optEl.dataset.oi);
          optEl.disabled = true;
          if (oi === r.correctIndex) optEl.classList.add("correct");
          else if (oi === answers[qi]) optEl.classList.add("wrong");
        });
        const q = questions[qi];
        const exp = qEl.querySelector(".quiz-explain");
        exp.style.display = "block";
        exp.innerHTML = r.correct
          ? `✅ <strong>Correct!</strong>${q.explanation ? " " + escM(q.explanation) : ""}`
          : `❌ <strong>Not quite.</strong> Correct answer: <strong>${String.fromCharCode(65 + r.correctIndex)}</strong>.${q.explanation ? " " + escM(q.explanation) : ""}`;
      });
      $("#submit-quiz").style.display = "none";

      const pct = Math.round((res.score / res.total) * 100);
      if (pct === 100) { sfx.levelUp(); confetti(); toast("🏆 PERFECT SCORE! +25 bonus XP", "good"); }
      else if (pct >= 70) { sfx.complete(); confetti(); toast(`✅ ${res.score}/${res.total} — great job! +${res.xpEarned} XP`, "good"); }
      else { sfx.wrong(); toast(`${res.score}/${res.total} — review the explanations and try again. +${res.xpEarned} XP`); }
      updateHud(res.progress);
      celebrate(res.progress);

      const again = document.createElement("div");
      again.style.textAlign = "center";
      again.style.marginTop = "14px";
      again.innerHTML = `<button class="btn secondary" id="retry-quiz">🔄 Retake quiz</button>`;
      $("#submit-quiz").parentElement.appendChild(again);
      $("#retry-quiz").onclick = () => showQuiz();
    };
  }
}

// ---------- course mode (Turbo-style structured lessons) ----------
const GOALS = [
  { id: "exam", label: "📅 Studying for an exam" },
  { id: "assignment", label: "📝 Working on an assignment" },
  { id: "learning", label: "🌱 Learning something new" },
  { id: "other", label: "✨ Something else" },
];
const FAMILIARITY = [
  { id: "new", label: "🌱 Brand new to me" },
  { id: "seen", label: "👀 I've seen some of it" },
  { id: "good", label: "🙂 I know it pretty well" },
  { id: "expert", label: "😎 I'm an expert in it" },
];

async function renderCourse(main, params) {
  const data = await api(`courses/${params.id}`);
  const { course, sections } = data;

  if (course.status === "generating" || course.status === "writing_sections") {
    return pollCourse(main, params.id);
  }
  if (course.status === "error" && !sections.some((s) => s.content)) {
    main.innerHTML = `
      <button class="btn secondary small" id="back">← Back to document</button>
      <h1 style="margin-top:14px">Course generation failed</h1>
      <div class="card"><p>❌ ${esc(course.error || "Unknown error")}</p>
      <p class="muted small">Free models are sometimes rate-limited. Try again, or pick another model in Settings.</p>
      <button class="btn" id="retry-course">🔄 Try again</button></div>`;
    $("#back").onclick = () => nav("document", { id: course.documentId });
    $("#retry-course").onclick = async () => {
      await api(`courses/${params.id}/regenerate`, { method: "POST" });
      render("course", { id: params.id });
    };
    return;
  }

  // ------- state -------
  let view = "intro"; // intro | contents | section | final | done
  let currentSection = 0;
  const warmupQs = data.questions.filter((q) => q.kind === "warmup").sort((a, b) => a.idx - b.idx);
  const finalQs = data.questions.filter((q) => q.kind === "final").sort((a, b) => a.idx - b.idx);

  main.innerHTML = `<div id="course-root"></div>`;
  const root = $("#course-root");

  const doneCount = () => sections.filter((s) => s.done).length;

  function header(active) {
    const pct = Math.round((doneCount() / sections.length) * 100);
    return `
      <button class="btn secondary small" id="back-doc">← Document</button>
      <h1 style="margin-top:14px">🎓 ${esc(course.title)}</h1>
      <p class="sub">
        <span class="badge ok">${doneCount()} of ${sections.length} sections complete</span>
        ${course.finalDone ? `<span class="badge ok">Final quiz: ${course.finalBest}/${course.finalTotal}</span>` : ""}
      </p>
      <div class="progress-track" style="max-width:480px"><div class="progress-fill" style="width:${pct}%"></div></div>
    `;
  }

  function bindBack() {
    $("#back-doc").onclick = () => nav("document", { id: course.documentId });
  }

  // ================= INTRO / GETTING STARTED =================
  function showIntro() {
    view = "intro";
    root.innerHTML = `
      ${header()}
      <div class="card notes-body">
        <h3>Welcome</h3>
        ${renderNotes(course.intro)}
        ${course.coverage.length ? `
          <h3>What you'll cover</h3>
          <ul>${course.coverage.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      </div>

      <div class="card">
        <h3>What's your goal for learning this?</h3>
        <div class="choice-row">${GOALS.map((g, i) => choiceBtn("goal", g, i + 1)).join("")}</div>
        <h3 style="margin-top:20px">How familiar are you with this topic?</h3>
        <div class="choice-row">${FAMILIARITY.map((f, i) => choiceBtn("fam", f, i + 1)).join("")}</div>
        <div style="margin-top:20px">
          <button class="btn" id="start-warmup" disabled>Start: a quick warm-up →</button>
        </div>
      </div>
    `;
    bindBack();
    const chosen = { goal: course.goal, fam: course.familiarity };
    const startBtn = $("#start-warmup");
    const refresh = () => { startBtn.disabled = !(chosen.goal && chosen.fam); };
    $$(".choice-btn").forEach((b) => {
      if (b.dataset.kind === "goal" && b.dataset.id === chosen.goal) b.classList.add("sel");
      if (b.dataset.kind === "fam" && b.dataset.id === chosen.fam) b.classList.add("sel");
      b.onclick = async () => {
        const kind = b.dataset.kind;
        $$(`.choice-btn[data-kind="${kind}"]`).forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel");
        if (kind === "goal") chosen.goal = b.dataset.id; else chosen.fam = b.dataset.id;
        refresh();
        sfx.click();
        await api(`courses/${course.id}/profile`, { method: "POST", body: { goal: chosen.goal, familiarity: chosen.fam } });
      };
    });
    refresh();
    if (course.warmupDone) {
      startBtn.textContent = "📖 Back to contents →";
      startBtn.onclick = () => showContents();
    } else {
      if (chosen.goal && chosen.fam) startBtn.textContent = "Start: a quick warm-up →";
      startBtn.onclick = () => showWarmup();
    }
  }

  function choiceBtn(kind, item, num) {
    return `<button class="choice-btn" data-kind="${kind}" data-id="${item.id}">
      <span class="choice-num">${num}</span> ${esc(item.label)}</button>`;
  }

  // ================= WARM-UP =================
  function showWarmup() {
    const answers = new Array(warmupQs.length).fill(-1);
    root.innerHTML = `
      ${header()}
      <div class="card">
        <h3>🧠 First, a quick warm-up</h3>
        <p class="muted small">A few questions to get your mind on the topic and see what you already know. No pressure to get them right — answer with your best guess. <strong>+${15} XP for finishing.</strong></p>
        ${warmupQs.map((q, qi) => mcqHtml(q, qi)).join("")}
        <div style="text-align:center;margin-top:16px">
          <button class="btn" id="finish-warmup" disabled>Finish warm-up</button>
        </div>
        <div id="warmup-result"></div>
      </div>
    `;
    bindBack();
    bindMcq(answers, "#finish-warmup");
    $("#finish-warmup").onclick = async () => {
      const res = await api(`courses/${course.id}/warmup-complete`, { method: "POST", body: { answers } });
      sfx.complete();
      revealMcq(warmupQs, answers, res.results);
      $("#finish-warmup").style.display = "none";
      updateHud(res.progress);
      celebrate(res.progress);
      toast(`🧠 Warm-up done — ${res.score}/${res.total} · +${res.xpEarned} XP`, "good");
      $("#warmup-result").innerHTML = `
        <div style="text-align:center;margin-top:16px">
          <button class="btn" id="to-contents">📖 Start section 1 →</button>
        </div>`;
      $("#to-contents").onclick = () => showContents();
    };
  }

  // ================= CONTENTS =================
  function showContents() {
    view = "contents";
    const allDone = doneCount() === sections.length;
    root.innerHTML = `
      ${header()}
      <h2>Contents</h2>
      <div class="card">
        ${sections.map((s, i) => `
          <div class="toc-row ${s.done ? "done" : ""} ${i > 0 && !sections[i - 1].done && !s.done ? "locked" : ""}" data-i="${i}">
            <span class="toc-num ${s.done ? "ok" : ""}">${s.done ? "✓" : i + 1}</span>
            <div style="flex:1">
              <div class="toc-title">${esc(s.title)}</div>
              <div class="muted small">${esc(s.summary || "")}</div>
            </div>
            ${s.status === "error" ? `<span class="badge" style="color:var(--bad)">failed</span>` : s.done ? `<span class="badge ok">${s.checkpoint_score}/${s.checkpoint_total}</span>` : ""}
          </div>`).join("")}
        ${allDone ? `
          <div class="toc-row final ${course.finalDone ? "done" : ""}" id="final-row">
            <span class="toc-num ${course.finalDone ? "ok" : ""}">${course.finalDone ? "✓" : "🏁"}</span>
            <div style="flex:1">
              <div class="toc-title">Final Quiz</div>
              <div class="muted small">Everything you've learned, cumulative</div>
            </div>
          </div>`
        : `<div class="muted small" style="padding:12px 6px">🔒 Finish every section to unlock the Final Quiz</div>`}
      </div>
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span class="muted small">📄 Intro, goals &amp; warm-up questions</span>
        <button class="btn secondary small" id="rewarmup">View intro &amp; warm-up</button>
      </div>
    `;
    bindBack();
    const rw = $("#rewarmup");
    if (rw) rw.onclick = () => showIntro();
    $$(".toc-row").forEach((row) => {
      row.onclick = () => {
        const i = Number(row.dataset.i);
        if (row.id === "final-row") return showFinal();
        if (row.classList.contains("locked")) { toast("🔒 Finish the previous section first — that's the whole point of a course!"); return; }
        showSection(i);
      };
    });
  }

  // ================= SECTION LESSON + CHECKPOINT =================
  function showSection(i) {
    view = "section";
    currentSection = i;
    const s = sections[i];
    if (s.status === "error") {
      root.innerHTML = `${header()}
        <div class="card"><h3>⚠️ This section failed to generate</h3><p class="muted small">${esc(s.error || "")}</p>
        <button class="btn" id="regen-course">🔄 Regenerate course</button></div>`;
      bindBack();
      $("#regen-course").onclick = async () => {
        await api(`courses/${course.id}/regenerate`, { method: "POST" });
        render("course", { id: course.id });
      };
      return;
    }

    const cp = s._checkpoint || (s._checkpoint = []); // filled after fetch below
    root.innerHTML = `
      ${header()}
      <div class="card notes-body">
        <p class="muted small">Section ${i + 1} of ${sections.length}</p>
        <h2 style="margin-top:4px">${esc(s.title)}</h2>
        ${renderNotes(s.content || "")}
      </div>
      <div class="card" id="cp-card">
        <h3>✅ Checkpoint</h3>
        <p class="muted small">Check your understanding before moving on. +${10} XP per correct answer, +${10} bonus if perfect, +${30} for completing the section (first time).</p>
        <div id="cp-loading" class="muted">Loading checkpoint…</div>
        <div id="cp-body"></div>
      </div>
    `;
    bindBack();

    api(`courses/${course.id}/status`).then((st) => {
      const serverSection = st.sections.find((x) => x.id === s.id);
      if (!serverSection) return;
      // checkpoint questions come with the section content endpoint
    });

    loadCheckpoint(s, i);
  }

  async function loadCheckpoint(s, i) {
    const qs = await api(`courses/${course.id}/sections/${s.id}/checkpoint`);
    s._checkpoint = qs.checkpoint;
    const body = $("#cp-body");
    if (!qs.checkpoint.length) {
      $("#cp-loading").textContent = "No checkpoint available for this section.";
      return;
    }
    $("#cp-loading").remove();
    const answers = new Array(qs.checkpoint.length).fill(-1);
    body.innerHTML = qs.checkpoint.map((q, qi) => mcqHtml(q, qi, "cp")).join("") + `
      <div style="text-align:center;margin-top:14px">
        <button class="btn" id="cp-finish" disabled>Submit checkpoint</button>
      </div>
      <div id="cp-result"></div>`;
    bindMcq(answers, "#cp-finish", "cp");
    $("#cp-finish").onclick = async () => {
      const res = await api(`courses/${course.id}/sections/${s.id}/complete`, { method: "POST", body: { answers } });
      s.done = true;
      s.checkpoint_score = res.score;
      s.checkpoint_total = res.total;
      revealMcq(qs.checkpoint, answers, res.results, "cp");
      $("#cp-finish").style.display = "none";
      updateHud(res.progress);
      celebrate(res.progress);
      if (res.score === res.total) { confetti(); sfx.levelUp(); }
      else sfx.complete();
      toast(res.first
        ? `🎉 Section complete! +${res.xpEarned} XP`
        : `✅ ${res.score}/${res.total} · +${res.xpEarned} XP`, "good");
      $("#cp-result").innerHTML = `
        <div style="text-align:center;margin-top:14px">
          ${i + 1 < sections.length
            ? `<button class="btn" id="next-section">Next section: ${esc(sections[i + 1].title)} →</button>`
            : `<button class="btn" id="go-final">🏁 Finish the course: Final Quiz →</button>`}
          <button class="btn secondary" id="toc-back" style="margin-left:8px">Contents</button>
        </div>`;
      const nb = $("#next-section");
      if (nb) nb.onclick = () => showSection(i + 1);
      const gf = $("#go-final");
      if (gf) gf.onclick = () => showFinal();
      $("#toc-back").onclick = () => showContents();
    };
  }

  // ================= FINAL QUIZ =================
  function showFinal() {
    if (doneCount() < sections.length) { showContents(); toast("🔒 Finish every section first!"); return; }
    const answers = new Array(finalQs.length).fill(-1);
    root.innerHTML = `
      ${header()}
      <div class="card">
        <h3>🏁 Final Quiz</h3>
        <p class="muted small">+${12} XP per correct answer · perfect score bonus +${40} XP</p>
        ${finalQs.map((q, qi) => mcqHtml(q, qi, "fin")).join("")}
        <div style="text-align:center;margin-top:16px">
          <button class="btn" id="submit-final" disabled>Submit final quiz</button>
        </div>
        <div id="final-result"></div>
      </div>
    `;
    bindBack();
    bindMcq(answers, "#submit-final", "fin");
    $("#submit-final").onclick = async () => {
      const res = await api(`courses/${course.id}/final-submit`, { method: "POST", body: { answers } });
      course.finalDone = true;
      course.finalBest = res.score;
      course.finalTotal = res.total;
      revealMcq(finalQs, answers, res.results, "fin");
      $("#submit-final").style.display = "none";
      updateHud(res.progress);
      celebrate(res.progress);
      if (res.perfect) { confetti(); confetti(); sfx.levelUp(); toast("🏆 PERFECT COURSE! +40 bonus XP", "good"); }
      else if (res.score / res.total >= 0.7) { confetti(); sfx.complete(); }
      else sfx.wrong();
      $("#final-result").innerHTML = `
        <div class="card" style="text-align:center;background:linear-gradient(160deg,var(--card),var(--card-2))">
          <div class="mascot">${res.perfect ? "🏆" : res.score / res.total >= 0.7 ? "🎉" : "💪"}</div>
          <h2>${res.score} / ${res.total}</h2>
          <p class="muted">${res.perfect ? "Flawless. You own this material now." : res.score / res.total >= 0.7 ? "Strong finish — review the explanations above for the ones you missed." : "Head back into the sections you found hard, then retake the quiz anytime."}</p>
          <p class="small" style="color:var(--warn)">+${res.xpEarned} XP earned</p>
          <button class="btn secondary" id="retake-final">🔄 Retake final quiz</button>
          <button class="btn" id="course-done">Back to contents</button>
        </div>`;
      $("#retake-final").onclick = () => showFinal();
      $("#course-done").onclick = () => showContents();
    };
  }

  // ================= shared MCQ helpers =================
  function mcqHtml(q, qi, prefix = "wu") {
    return `
      <div class="quiz-q" data-prefix="${prefix}" data-qi="${qi}">
        <div class="q-text">${qi + 1}. ${escM(q.question)}</div>
        ${q.options.map((opt, oi) => `<button class="opt" data-oi="${oi}">${String.fromCharCode(65 + oi)}. ${escM(opt)}</button>`).join("")}
        <div class="quiz-explain" style="display:none"></div>
      </div>`;
  }

  function bindMcq(answers, finishSel, prefix = "wu") {
    $$(`.quiz-q[data-prefix="${prefix}"]`).forEach((qEl) => {
      const qi = Number(qEl.dataset.qi);
      $$(".opt", qEl).forEach((optEl) => {
        optEl.onclick = () => {
          $$(".opt", qEl).forEach((o) => o.classList.remove("sel"));
          optEl.classList.add("sel");
          answers[qi] = Number(optEl.dataset.oi);
          const btn = $(finishSel);
          if (btn) btn.disabled = answers.some((a) => a === -1);
          sfx.click();
        };
      });
    });
  }

  function revealMcq(questions, answers, results, prefix = "wu") {
    $$(`.quiz-q[data-prefix="${prefix}"]`).forEach((qEl, qi) => {
      const r = results[qi];
      $$(".opt", qEl).forEach((optEl) => {
        const oi = Number(optEl.dataset.oi);
        optEl.disabled = true;
        if (oi === r.correctIndex) optEl.classList.add("correct");
        else if (oi === answers[qi]) optEl.classList.add("wrong");
      });
      const q = questions[qi];
      const exp = qEl.querySelector(".quiz-explain");
      exp.style.display = "block";
      exp.innerHTML = r.correct
        ? `✅ <strong>Correct!</strong>${q.explanation ? " " + escM(q.explanation) : ""}`
        : `❌ <strong>Not quite.</strong> Correct answer: <strong>${String.fromCharCode(65 + r.correctIndex)}</strong>.${q.explanation ? " " + escM(q.explanation) : ""}`;
    });
  }

  // entry point: resume where the learner left off — never force them through
  // the goal/familiarity pickers or the warm-up again once completed
  function resume() {
    if (course.warmupDone) showContents();
    else showIntro();
  }
  resume();
}

async function pollCourse(main, courseId) {
  main.innerHTML = `
    <div class="card" style="max-width:560px;margin:40px auto;text-align:center;padding:36px">
      <div class="mascot">🎓</div>
      <h2>Building your course…</h2>
      <p class="muted" id="poll-msg">Designing the outline and writing each section. This takes a few minutes on free models — the page updates automatically.</p>
      <div class="progress-track"><div class="progress-fill" id="poll-fill" style="width:10%"></div></div>
      <p class="muted small" id="poll-detail"></p>
    </div>`;
  while (true) {
    await new Promise((r) => setTimeout(r, 4000));
    let st;
    try {
      st = await api(`courses/${courseId}/status`);
    } catch {
      continue;
    }
    if (st.course.status === "ready") {
      toast("🎓 Course ready!", "good");
      sfx.complete();
      return render("course", { id: courseId });
    }
    if (st.course.status === "error" && st.sectionsDone === 0) {
      return render("course", { id: courseId });
    }
    const pct = st.sectionsTotal ? 10 + Math.round((st.sectionsDone / st.sectionsTotal) * 85) : 15;
    $("#poll-fill").style.width = pct + "%";
    $("#poll-detail").textContent = `Writing section ${Math.min(st.sectionsDone + 1, st.sectionsTotal)} of ${st.sectionsTotal}…`;
  }
}

// ---------- settings ----------
async function renderSettings(main) {
  const cfg = await api("ai/config");
  const p = cfg.presets;

  main.innerHTML = `
    <h1>AI Settings</h1>
    <p class="sub">StudyForge works with any OpenAI-compatible provider. Free options are listed first.</p>
    <div class="card">
      <h3>Provider</h3>
      <select id="provider" style="width:100%;max-width:420px">
        ${p.map((x) => `<option value="${esc(x.id)}" ${x.id === cfg.providerId ? "selected" : ""}>${esc(x.label)}</option>`).join("")}
      </select>
      <div id="preset-hint" class="muted small" style="margin-top:8px"></div>

      <h3 style="margin-top:18px">API key</h3>
      <input type="password" id="apikey" style="width:100%;max-width:420px" placeholder="Paste your API key" value="${esc(cfg.apiKey)}" />
      <div class="muted small" style="margin-top:6px" id="key-hint"></div>

      <h3 style="margin-top:18px">Base URL</h3>
      <input type="text" id="baseurl" style="width:100%;max-width:420px" value="${esc(cfg.baseUrl)}" />

      <h3 style="margin-top:18px">Model</h3>
      <input type="text" id="model" style="width:100%;max-width:420px" value="${esc(cfg.model)}" placeholder="e.g. deepseek-v4-flash-free, gpt-4o-mini, llama3.1" />
      <div class="muted small" style="margin-top:6px">Free picks: OpenCode Zen <code>deepseek-v4-flash-free</code> · OpenRouter <code>google/gemini-2.0-flash-exp:free</code></div>

      <div style="margin-top:22px;display:flex;gap:10px">
        <button class="btn" id="save-settings">💾 Save settings</button>
        <button class="btn secondary" id="test-ai">🧪 Test connection</button>
      </div>
      <div id="test-result" class="small" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h3>🔊 Sound &amp; speech</h3>
      <label style="display:block;margin:8px 0;cursor:pointer">
        <input type="checkbox" id="snd-rewards" checked style="margin-right:8px" /> Reward sounds (correct answers, level-ups, streaks)
      </label>
      <label style="display:block;margin:8px 0;cursor:pointer">
        <input type="checkbox" id="snd-tts" ${localStorage.getItem("sf-tts") !== "off" ? "checked" : ""} style="margin-right:8px" /> Read flashcards aloud while reviewing (uses your browser's voice)
      </label>
      <p class="muted small">StudyForge never generates spoken explanations or podcasts — it only reads your flashcards aloud and plays short reward sounds.</p>
    </div>
  `;

  const sel = $("#provider");
  const updatePreset = () => {
    const preset = p.find((x) => x.id === sel.value);
    $("#preset-hint").innerHTML = preset && preset.hint ? esc(preset.hint) : "";
    if (preset) {
      if (preset.baseUrl) $("#baseurl").value = preset.baseUrl;
      $("#model").value = preset.defaultModel;
      $("#key-hint").innerHTML = preset.keyUrl ? `Get a key: <a href="${esc(preset.keyUrl)}" target="_blank" rel="noopener">${esc(preset.keyUrl)}</a>` : (preset.hint || "");
    }
  };
  sel.addEventListener("change", updatePreset);
  updatePreset();

  $("#save-settings").onclick = async () => {
    await api("settings", {
      method: "PUT",
      body: {
        providerId: sel.value,
        apiKey: $("#apikey").value.trim(),
        baseUrl: $("#baseurl").value.trim(),
        model: $("#model").value.trim(),
      },
    });
    sfx.correct();
    toast("✅ Settings saved", "good");
  };

  $("#test-ai").onclick = async () => {
    $("#test-result").innerHTML = `<span class="spin">⏳</span> Testing…`;
    await api("settings", {
      method: "PUT",
      body: {
        providerId: sel.value,
        apiKey: $("#apikey").value.trim(),
        baseUrl: $("#baseurl").value.trim(),
        model: $("#model").value.trim(),
      },
    });
    try {
      const r = await fetch("/api/test-ai", { method: "POST" });
      const d = await r.json();
      if (d.ok) { $("#test-result").innerHTML = `✅ <strong style="color:var(--good)">Works!</strong> ${esc(d.reply)}`; sfx.correct(); }
      else { $("#test-result").innerHTML = `❌ <span style="color:var(--bad)">${esc(d.error)}</span>`; sfx.wrong(); }
    } catch (e) {
      $("#test-result").innerHTML = `❌ ${esc(e.message)}`;
    }
  };

  $("#snd-rewards").addEventListener("change", (e) => localStorage.setItem("sf-sfx", e.target.checked ? "on" : "off"));
  $("#snd-tts").addEventListener("change", (e) => {
    localStorage.setItem("sf-tts", e.target.checked ? "on" : "off");
    setTtsEnabled(e.target.checked);
  });
}

// ---------- boot ----------
(function bootFromHash() {
  const h = location.hash.replace(/^#\//, "").replace(/^#/, "");
  if (!h) return render("dashboard", {});
  const [route, id] = h.split("/");
  if (routes[route]) render(route, id ? { id } : {});
  else render("dashboard", {});
})();
