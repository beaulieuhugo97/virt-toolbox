// Virtualization Toolbox webview front-end.
// One form engine renders any tool from its serialized manifest; an output view
// streams captured runs and renders parsed tables; the home, config and history
// views reuse the same primitives. The webview never builds a command — it
// displays the host-resolved string and asks the host to run it.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");

  let tool = null; // current SerializedTool
  let interfaces = []; // [{name,address}] for `interface` fields
  const state = {}; // fieldId -> string value
  const fieldEls = {}; // fieldId -> { wrapper, when }
  const previewEls = {}; // actionId -> <pre>
  const actionEls = {}; // actionId -> { card, when }
  const resolvedCmd = {}; // actionId -> string
  let outputFileByAction = {};

  // ---- helpers ---------------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") e.className = attrs[k];
        else if (k === "text") e.textContent = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function")
          e.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function spinner() {
    return el("span", { class: "spinner" });
  }
  // Inline SVG icon (crisp + inherits button color/size, unlike ⚙/↻ glyphs).
  function svgIcon(d, size) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 16));
    svg.setAttribute("height", String(size || 16));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("link-ico");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }
  const ICON_GEAR =
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.6-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.49.49 0 00-.49-.42h-3.84a.49.49 0 00-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.6.22L2.74 8.87a.49.49 0 00.12.61l2.03 1.58c-.05.3-.07.62-.07.94 0 .32.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.13.24.41.33.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.06.24.26.42.49.42h3.84c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.12-.56 1.62-.94l2.39.96c.23.09.51 0 .6-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z";
  const ICON_HISTORY =
    "M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 117 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.99 8.99 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z";
  function statusLine(cls, label) {
    return el("div", { class: "run-status " + (cls || "") }, [spinner(), document.createTextNode(" " + label)]);
  }

  // A small "Copy" button. getText() is read at click time so it always copies
  // the currently-resolved command, not a stale snapshot. Falls back to a hidden
  // textarea + execCommand when the async clipboard API is unavailable.
  function copyButton(getText) {
    const btn = el("button", { class: "copy-btn", type: "button", text: "Copy", title: "Copy to clipboard" });
    btn.addEventListener("click", () => {
      const text = getText() || "";
      const done = () => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy"), 1200); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else {
          fallbackCopy(text, done);
        }
      } catch (e) {
        fallbackCopy(text, done);
      }
    });
    return btn;
  }
  // A pill that copies `sudo apt install <dep>` for a missing dependency.
  function installButton(dep) {
    const cmd = "sudo apt install " + dep;
    const btn = el("button", { class: "copy-btn", type: "button", text: "apt install", title: "Copy: " + cmd });
    btn.addEventListener("click", () => {
      const done = () => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "apt install"), 1200); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(cmd).then(done, () => fallbackCopy(cmd, done));
        } else {
          fallbackCopy(cmd, done);
        }
      } catch (e) {
        fallbackCopy(cmd, done);
      }
    });
    return btn;
  }
  function fallbackCopy(text, done) {
    const ta = el("textarea", {});
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
  }

  // Mirror of host template/resolver.evalWhen — declarative conditions.
  function evalWhen(when, st) {
    if (!when) return true;
    if (when.all) return when.all.every((w) => evalWhen(w, st));
    if (when.any) return when.any.some((w) => evalWhen(w, st));
    if (when.not) return !evalWhen(when.not, st);
    const v = st[when.field] || "";
    if (when.truthy) return v !== "" && v !== "false";
    if (when.in) return when.in.indexOf(v) >= 0;
    const t = when.equals;
    return Array.isArray(t) ? t.indexOf(v) >= 0 : v === t;
  }

  // A star toggle that reflects favorite state and asks the host to persist it.
  function favStar(toolId, isFav) {
    const btn = el("button", {
      class: "fav-star" + (isFav ? " on" : ""),
      type: "button",
      title: isFav ? "Remove from favorites" : "Add to favorites",
      text: isFav ? "★" : "☆",
      "data-tool": toolId,
    });
    btn.addEventListener("click", () => vscode.postMessage({ type: "toggleFavorite", toolId }));
    return btn;
  }

  // ---- tool form -------------------------------------------------------------
  function renderTool(t, isFavorite) {
    tool = t;
    for (const k in state) delete state[k];
    for (const k in fieldEls) delete fieldEls[k];
    for (const k in previewEls) delete previewEls[k];
    for (const k in actionEls) delete actionEls[k];
    outputFileByAction = {};
    clear(app);

    const root = el("div", { class: "tool" });
    const header = el("div", { class: "tool-header" }, []);
    const titleRow = el("div", { class: "title-row" }, [
      el("h1", { text: t.label }),
      favStar(t.id, !!isFavorite),
    ]);
    header.appendChild(titleRow);
    header.appendChild(el("div", { class: "crumbs", text: t.category }));
    const deps = el("div", { class: "deps", id: "deps" });
    header.appendChild(deps);
    root.appendChild(header);

    // Install/setup actions are hoisted to a dedicated block at the very top of
    // the page — the install step should be the first thing seen, not buried at
    // the bottom of the actions list. Everything else renders in its usual place.
    const allActions = t.actions || [];
    const isInstall = (a) => /^install(-|$)/.test(a.id);
    const installActions = allActions.filter(isInstall);
    const otherActions = allActions.filter((a) => !isInstall(a));

    if (installActions.length) {
      const setup = el("div", { class: "setup-box" });
      setup.appendChild(el("h2", { class: "setup-title", text: "Setup" }));
      const setupActions = el("div", { class: "actions" });
      // Strip the section so a hoisted install stays visible on every tab; its
      // `when` gating is preserved by renderAction.
      installActions.forEach((a) =>
        setupActions.appendChild(renderAction(Object.assign({}, a, { section: undefined })))
      );
      setup.appendChild(setupActions);
      root.appendChild(setup);
    }

    // tabs (sectioned tools) — only for sections still populated after the
    // install actions are hoisted out (a now-empty "setup" tab is dropped).
    if (t.sections && t.sections.length) {
      const used = new Set();
      (t.fields || []).forEach((f) => { if (f.section) used.add(f.section); });
      otherActions.forEach((a) => { if (a.section) used.add(a.section); });
      const visibleSections = t.sections.filter((s) => used.has(s.id));
      if (visibleSections.length) {
        state.__section = visibleSections[0].id;
        if (visibleSections.length > 1) {
          const tabs = el("div", { class: "tabs" });
          visibleSections.forEach((s) => {
            const b = el("button", {
              class: "tab" + (s.id === state.__section ? " active" : ""),
              type: "button",
              text: s.label,
              onclick: () => {
                state.__section = s.id;
                [...tabs.children].forEach((c) => c.classList.remove("active"));
                b.classList.add("active");
                applyConditions();
                resolveAll();
              },
            });
            tabs.appendChild(b);
          });
          root.appendChild(tabs);
        }
      }
    }

    // fields
    const form = el("div", { class: "fields" });
    (t.fields || []).forEach((f) => {
      state[f.id] = f.default != null ? f.default : "";
      const wrapper = renderField(f);
      fieldEls[f.id] = { wrapper, when: f.when, section: f.section };
      form.appendChild(wrapper);
    });
    root.appendChild(form);

    // actions (everything except the hoisted install actions)
    if (otherActions.length) {
      const actions = el("div", { class: "actions" });
      otherActions.forEach((a) => actions.appendChild(renderAction(a)));
      root.appendChild(actions);
    }

    // notes (target-side instructions), filled by the `resolved` message
    if (t.hasNotes) {
      const notes = el("div", { class: "notes-box", id: "notes" });
      notes.appendChild(el("h2", { text: t.notesTitle || "Instructions" }));
      notes.appendChild(el("div", { class: "notes-list", id: "notes-list" }));
      root.appendChild(notes);
    }

    // output
    root.appendChild(
      el("div", { class: "output", id: "output" }, [el("div", { class: "output-empty", text: "Output will appear here after a run." })])
    );

    app.appendChild(root);
    applyConditions();
    resolveAll();
  }

  // Required fields carry a red asterisk, optional ones a dim "(optional)", so
  // the two are never told apart by guesswork. Manifest labels that already end
  // in a bare "(optional)" are normalized (the marker replaces it); labels whose
  // parenthetical carries more than that — "Port (optional, -s)" — are left alone
  // so the extra hint survives, and no second marker is added.
  function fieldLabel(text, required, forId) {
    let base = String(text == null ? "" : text);
    let mentionsOptional = /optional/i.test(base);
    const bare = base.replace(/\s*\((?:optional)\)\s*$/i, "");
    if (bare !== base) { base = bare; mentionsOptional = false; }
    const label = el("label", { for: forId }, [document.createTextNode(base)]);
    if (required) label.appendChild(el("span", { class: "req", text: "*", title: "Required" }));
    else if (!mentionsOptional) label.appendChild(el("span", { class: "opt", text: "optional" }));
    return label;
  }

  function renderField(f) {
    const wrapper = el("div", { class: "field", "data-field": f.id });
    wrapper.appendChild(fieldLabel(f.label, !!f.required, "f_" + f.id));

    let control;
    const commit = (v) => {
      state[f.id] = v;
      applyConditions();
      resolveAll();
    };

    if (f.type === "select") {
      control = el("select", { id: "f_" + f.id, onchange: (e) => commit(e.target.value) });
      (f.options || []).forEach((o) => {
        const opt = el("option", { value: o.value, text: o.label });
        if (o.value === state[f.id]) opt.selected = true;
        control.appendChild(opt);
      });
    } else if (f.type === "segment") {
      control = el("div", { class: "segment", id: "f_" + f.id });
      (f.options || []).forEach((o) => {
        const btn = el("button", {
          class: "seg-btn" + (o.value === state[f.id] ? " active" : ""),
          type: "button",
          text: o.label,
          onclick: () => {
            state[f.id] = o.value;
            [...control.children].forEach((c) => c.classList.remove("active"));
            btn.classList.add("active");
            applyConditions();
            resolveAll();
          },
        });
        control.appendChild(btn);
      });
    } else if (f.type === "check") {
      control = el("label", { class: "check" });
      const box = el("input", { type: "checkbox", id: "f_" + f.id });
      box.checked = state[f.id] === "true";
      state[f.id] = box.checked ? "true" : "";
      box.addEventListener("change", (e) => commit(e.target.checked ? "true" : ""));
      control.appendChild(box);
      control.appendChild(el("span", { text: " " + (f.help || f.label) }));
    } else if (f.type === "interface") {
      // Tool-level interface fields yield the device NAME (e.g. virbr0 for a
      // bridge), not the address.
      control = el("select", { id: "f_" + f.id, onchange: (e) => commit(e.target.value) });
      interfaces.forEach((i) => {
        const opt = el("option", { value: i.name, text: i.name + " — " + i.address });
        if (i.name === state[f.id]) opt.selected = true;
        control.appendChild(opt);
      });
      if (interfaces.length) { state[f.id] = state[f.id] || interfaces[0].name; }
    } else if (f.type === "textarea") {
      control = el("textarea", {
        id: "f_" + f.id,
        class: "field-textarea",
        rows: 4,
        placeholder: f.placeholder || "",
        oninput: (e) => commit(e.target.value),
      });
      control.value = state[f.id] || "";
    } else if (f.type === "file") {
      control = el("div", { class: "file-row" });
      const input = el("input", {
        type: "text",
        id: "f_" + f.id,
        value: state[f.id],
        placeholder: f.placeholder || "",
        oninput: (e) => commit(e.target.value),
      });
      const browse = el("button", {
        class: "browse",
        type: "button",
        text: "Browse…",
        onclick: () =>
          vscode.postMessage({ type: "pickFile", fieldId: f.id, fileKind: f.fileKind || "file", rootConfig: f.rootConfig }),
      });
      control.appendChild(input);
      control.appendChild(browse);
    } else {
      // text / port / password / interface (fallback to text)
      control = el("input", {
        id: "f_" + f.id,
        type: f.type === "password" ? "password" : "text",
        inputmode: f.type === "port" ? "numeric" : undefined,
        value: state[f.id],
        placeholder: f.placeholder || "",
        oninput: (e) => commit(e.target.value),
      });
    }
    wrapper.appendChild(control);
    if (f.help && f.type !== "check") wrapper.appendChild(el("div", { class: "help", text: f.help }));
    return wrapper;
  }

  // Mirror of host resolver.visibleFieldIds — visibility cascades to a fixpoint
  // so a field gated on a now-hidden field (e.g. -sV on modeTcp) also hides.
  function applyConditions() {
    const fields = (tool && tool.fields) || [];
    const sectionOk = (item) => !item.section || item.section === state.__section;
    const visible = {};
    fields.forEach((f) => (visible[f.id] = sectionOk(f)));
    for (let pass = 0; pass <= fields.length; pass++) {
      let changed = false;
      const eff = {};
      fields.forEach((f) => (eff[f.id] = visible[f.id] ? state[f.id] || "" : ""));
      fields.forEach((f) => {
        const show = sectionOk(f) && (!f.when || evalWhen(f.when, eff));
        if (show !== visible[f.id]) { visible[f.id] = show; changed = true; }
      });
      if (!changed) break;
    }
    for (const id in fieldEls) {
      fieldEls[id].wrapper.classList.toggle("hidden", !visible[id]);
    }
    // action visibility (section + `when`) uses effective field state
    const eff = {};
    fields.forEach((f) => (eff[f.id] = visible[f.id] ? state[f.id] || "" : ""));
    for (const id in actionEls) {
      const a = actionEls[id];
      a.card.classList.toggle("hidden", !(sectionOk(a) && evalWhen(a.when, eff)));
    }
  }

  function renderAction(a) {
    const card = el("div", { class: "action-card" });
    card.appendChild(el("div", { class: "action-label", text: a.label }));
    const pre = el("pre", { class: "command", text: "Resolving…" });
    previewEls[a.id] = pre;
    const cmdHead = el("div", { class: "command-head" }, [el("div", { class: "command-tag", text: "Command to execute" }), copyButton(() => resolvedCmd[a.id])]);
    card.appendChild(el("div", { class: "command-wrap" }, [cmdHead, pre]));

    const btnRow = el("div", { class: "btn-row" });
    const run = el("button", {
      class: "run",
      type: "button",
      text: a.mode === "terminal" ? "Run in terminal" : "Run",
      onclick: () => vscode.postMessage({ type: "run", toolId: tool.id, actionId: a.id, state: state }),
    });
    btnRow.appendChild(run);
    // Offer the opposite execution mode as a secondary button, so every action
    // can run both ways: a captured action can be sent to a terminal, and a
    // terminal action can be captured into the webview output.
    const altMode = a.mode === "captured" ? "terminal" : "captured";
    btnRow.appendChild(
      el("button", {
        class: "run-secondary",
        type: "button",
        text: altMode === "terminal" ? "Run in terminal" : "Run",
        title:
          altMode === "terminal"
            ? "Run in an integrated terminal instead"
            : "Run and capture the output here instead",
        onclick: () =>
          vscode.postMessage({ type: "run", toolId: tool.id, actionId: a.id, state: state, mode: altMode }),
      })
    );
    const stop = el("button", { class: "stop hidden", type: "button", text: "Stop", onclick: () => vscode.postMessage({ type: "stop" }) });
    btnRow.appendChild(stop);
    card.appendChild(btnRow);
    card._run = run;
    card._stop = stop;
    actionEls[a.id] = { card, when: a.when, section: a.section };
    return card;
  }

  // Paths that don't exist yet, keyed by field id — the host recomputes these on
  // every resolve. A missing ISO or disk image would otherwise only surface as a
  // bare "no such file" once the tool ran, so the form says so up front.
  function applyFileWarnings(warnings) {
    for (const id in fieldEls) {
      const existing = fieldEls[id].wrapper.querySelector(".field-warn");
      if (existing) existing.remove();
    }
    (warnings || []).forEach((w) => {
      const entry = fieldEls[w.fieldId];
      if (!entry) return;
      const box = el("div", { class: "field-warn" });
      box.appendChild(el("span", { class: "field-warn-ico", text: "⚠" }));
      const body = el("div", { class: "field-warn-body" });
      body.appendChild(el("div", { text: "This file does not exist — the run would fail." }));
      body.appendChild(el("code", { class: "field-warn-path", text: w.path }));
      box.appendChild(body);
      entry.wrapper.appendChild(box);
    });
  }

  function resolveAll() {
    if (!tool) return;
    vscode.postMessage({ type: "resolve", toolId: tool.id, state: state });
  }

  function renderNotes(notes) {
    const list = document.getElementById("notes-list");
    if (!list) return;
    clear(list);
    (notes || []).forEach((n, i) => {
      const step = el("div", { class: "note-step" });
      step.appendChild(el("div", { class: "note-label", text: (i + 1) + ". " + n.label }));
      if (n.command) {
        const cmd = n.command;
        step.appendChild(el("div", { class: "note-cmd-row" }, [el("pre", { class: "note-cmd", text: cmd }), copyButton(() => cmd)]));
      }
      list.appendChild(step);
    });
  }

  function setRunning(running) {
    document.querySelectorAll(".action-card").forEach((c) => {
      if (c._run) c._run.disabled = running;
      if (c._stop) c._stop.classList.toggle("hidden", !running);
    });
  }

  // ---- output view -----------------------------------------------------------
  function outputNode() {
    return document.getElementById("output");
  }
  function startOutput(command) {
    const out = outputNode();
    if (!out) return;
    clear(out);
    if (command) out.appendChild(el("div", { class: "run-cmd", text: "$ " + command }));
    out.appendChild(el("pre", { class: "log", id: "log" }));
    const rs = statusLine("", "Running…");
    rs.id = "run-status";
    out.appendChild(rs);
  }
  function appendLog(chunk) {
    const log = document.getElementById("log");
    if (!log) return;
    log.textContent += chunk;
    log.scrollTop = log.scrollHeight;
  }
  function finishOutput(code, table, outputFile) {
    const status = document.getElementById("run-status");
    if (status) {
      status.textContent = code === 0 ? "✓ Completed (exit 0)" : "Exit code " + code;
      status.className = "run-status " + (code === 0 ? "ok" : "err");
    }
    const out = outputNode();
    if (table && out) out.appendChild(renderTable(table));
    if (outputFile && out) {
      out.appendChild(
        el("div", { class: "output-file" }, [
          el("span", { text: "Output file: " }),
          el("a", { class: "file-link", href: "#", text: outputFile, onclick: (e) => { e.preventDefault(); vscode.postMessage({ type: "openFile", path: outputFile }); } }),
        ])
      );
    }
  }

  // ---- sortable table --------------------------------------------------------
  function renderTable(t) {
    const box = el("div", { class: "table-box" });
    if (t.title) box.appendChild(el("div", { class: "table-title", text: t.title }));
    const table = el("table", { class: "data-table" });
    const thead = el("thead");
    const htr = el("tr");
    let sortCol = -1;
    let sortAsc = true;
    const rows = t.rows.map((r) => r.slice());
    const tbody = el("tbody");

    function paint() {
      clear(tbody);
      rows.forEach((r) => {
        const tr = el("tr");
        r.forEach((cell) => tr.appendChild(el("td", { text: cell })));
        tbody.appendChild(tr);
      });
    }
    function sortBy(i) {
      sortAsc = sortCol === i ? !sortAsc : true;
      sortCol = i;
      const num = rows.every((r) => r[i] === "" || !isNaN(parseFloat(r[i])));
      rows.sort((a, b) => {
        const av = a[i], bv = b[i];
        const c = num ? parseFloat(av || "0") - parseFloat(bv || "0") : String(av).localeCompare(String(bv));
        return sortAsc ? c : -c;
      });
      [...htr.children].forEach((th, j) => (th.dataset.sort = j === i ? (sortAsc ? "asc" : "desc") : ""));
      paint();
    }

    t.columns.forEach((c, i) => {
      const th = el("th", { text: c, onclick: () => sortBy(i) });
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    table.appendChild(tbody);
    paint();
    box.appendChild(el("div", { class: "table-scroll" }, [table]));
    return box;
  }

  // ---- gate badges (deps / service / group) ----------------------------------
  function badge(box, ok, text) {
    box.appendChild(el("span", { class: "dep-badge " + (ok ? "ok" : "missing"), text: (ok ? "✓ " : "✗ ") + text }));
  }
  function renderGates(g) {
    const box = document.getElementById("deps");
    if (!box || !tool) return;
    clear(box);
    (g.deps || []).forEach((d) => {
      badge(box, d.ok, d.name);
      // Turn a red badge into an action: copy the install command.
      if (!d.ok) box.appendChild(installButton(d.name));
    });
    (g.verify || []).forEach((v) => {
      const b = el("span", { class: "dep-badge " + (v.ok ? "ok" : "missing"), text: (v.ok ? "✓ " : "✗ ") + v.label, title: v.hint || "" });
      box.appendChild(b);
    });
    if (g.service) {
      badge(box, g.service.active, g.service.name + (g.service.active ? " running" : " stopped"));
      if (!g.service.active) box.appendChild(el("button", { class: "gate-btn", type: "button", text: "Start", onclick: () => vscode.postMessage({ type: "startService", service: g.service.name }) }));
    }
    if (g.group) {
      badge(box, g.group.member, g.group.member ? g.group.name + " group" : "not in " + g.group.name + " group");
      if (!g.group.member) box.appendChild(el("button", { class: "gate-btn", type: "button", text: "Add me", onclick: () => vscode.postMessage({ type: "addGroup", group: g.group.name }) }));
    }
  }

  // ---- home dashboard --------------------------------------------------------
  // The landing view when no tool is selected. Everything shown is data the host
  // already holds (config, run history, registry) — no new manifest concepts.
  function renderHome(m) {
    tool = null;
    clear(app);
    const root = el("div", { class: "home" });
    const s = m.stats || {};

    // Hero header with an accent bar and at-a-glance stat cards.
    const hero = el("div", { class: "hero" });
    hero.appendChild(el("div", { class: "hero-bar" }));
    const heroBody = el("div", { class: "hero-body" });
    heroBody.appendChild(el("h1", { text: "Virtualization Toolbox" }));
    heroBody.appendChild(el("div", { class: "crumbs", text: "Pick a tool, review the exact command, and run it." }));
    hero.appendChild(heroBody);
    root.appendChild(hero);

    const stats = el("div", { class: "stat-row" });
    [
      { n: s.toolCount || 0, l: "tools" },
      { n: s.categoryCount || 0, l: "categories" },
      { n: s.runCount || 0, l: "runs logged" },
    ].forEach((c) => {
      const card = el("div", { class: "stat-card" });
      card.appendChild(el("div", { class: "stat-n", text: String(c.n) }));
      card.appendChild(el("div", { class: "stat-l", text: c.l }));
      stats.appendChild(card);
    });
    root.appendChild(stats);

    // Quick links
    const links = el("div", { class: "home-links" });
    links.appendChild(el("button", { class: "run home-link", type: "button", onclick: () => vscode.postMessage({ type: "openConfig" }) }, [
      svgIcon(ICON_GEAR), document.createTextNode("Configuration"),
    ]));
    links.appendChild(el("button", { class: "run-secondary home-link", type: "button", onclick: () => vscode.postMessage({ type: "openHistory" }) }, [
      svgIcon(ICON_HISTORY), document.createTextNode("Run history"),
    ]));
    root.appendChild(links);

    // Category grid — each card opens the tool finder scoped to that category.
    if (m.categories && m.categories.length) {
      root.appendChild(el("h2", { text: "Browse by category" }));
      const grid = el("div", { class: "cat-grid" });
      m.categories.forEach((c) => {
        const card = el("button", {
          class: "cat-card",
          type: "button",
          title: c.count + " tool" + (c.count === 1 ? "" : "s"),
          onclick: () => vscode.postMessage({ type: "findInCategory", category: c.name }),
        });
        card.appendChild(el("div", { class: "cat-tile", text: (c.name[0] || "?").toUpperCase() }));
        const meta = el("div", { class: "cat-meta" });
        meta.appendChild(el("div", { class: "cat-name", text: c.name.replace(/_/g, " ") }));
        meta.appendChild(el("div", { class: "cat-count", text: c.count + " tool" + (c.count === 1 ? "" : "s") }));
        card.appendChild(meta);
        grid.appendChild(card);
      });
      root.appendChild(grid);
    }

    // Current target / config summary
    root.appendChild(el("h2", { text: "Current target" }));
    const grid = el("div", { class: "home-config" });
    (m.config || []).forEach((c) => {
      const cell = el("div", { class: "home-config-cell" });
      cell.appendChild(el("div", { class: "home-config-label", text: c.label }));
      cell.appendChild(el("div", { class: "home-config-value" + (c.value ? "" : " unset"), text: c.value || "— not set —" }));
      grid.appendChild(cell);
    });
    root.appendChild(grid);

    // Quick launch chips
    if (m.quickTools && m.quickTools.length) {
      root.appendChild(el("h2", { text: "Quick launch" }));
      const chips = el("div", { class: "home-chips" });
      m.quickTools.forEach((t) => {
        chips.appendChild(el("button", {
          class: "home-chip" + (t.favorite ? " fav" : ""),
          type: "button",
          title: t.category,
          text: (t.favorite ? "★ " : "") + t.label,
          onclick: () => vscode.postMessage({ type: "openTool", toolId: t.id }),
        }));
      });
      root.appendChild(chips);
    }

    // Recent activity
    root.appendChild(el("h2", { text: "Recent activity" }));
    if (!m.recent || !m.recent.length) {
      root.appendChild(el("div", { class: "output-empty", text: "No runs yet — launch a tool and it will appear here." }));
    } else {
      const list = el("div", { class: "home-recent" });
      m.recent.forEach((e) => {
        const row = el("div", { class: "home-recent-row" });
        const main = el("div", { class: "home-recent-main" });
        main.appendChild(el("a", { class: "file-link", href: "#", text: e.toolLabel + " — " + e.actionLabel, onclick: (ev) => { ev.preventDefault(); vscode.postMessage({ type: "openTool", toolId: e.toolId }); } }));
        main.appendChild(el("code", { class: "hist-cmd", text: e.command }));
        row.appendChild(main);
        const acts = el("div", { class: "hist-actions" });
        acts.appendChild(el("button", { class: "gate-btn", type: "button", text: "Re-run", onclick: () => vscode.postMessage({ type: "rerun", id: e.id }) }));
        if (e.outputFile) acts.appendChild(el("button", { class: "gate-btn", type: "button", text: "Output", onclick: () => vscode.postMessage({ type: "openFile", path: e.outputFile }) }));
        row.appendChild(acts);
        list.appendChild(row);
      });
      root.appendChild(list);
    }

    app.appendChild(root);
  }

  // ---- config panel ----------------------------------------------------------
  function renderConfig(groups, values, interfaces) {
    clear(app);
    const root = el("div", { class: "config" });
    root.appendChild(el("h1", { text: "Configuration" }));
    root.appendChild(el("div", { class: "crumbs", text: "Values injected into every tool's command templates." }));

    groups.forEach((g) => {
      const section = el("div", { class: "config-group" });
      section.appendChild(el("h2", { text: g.title }));
      g.items.forEach((item) => {
        const row = el("div", { class: "field" });
        // "port" validates as a port but is still a value the tool needs — only an
        // explicit "optional" renders as optional.
        row.appendChild(fieldLabel(item.label, item.validation !== "optional"));
        const val = values[item.key] != null ? values[item.key] : "";
        let control;
        if (item.type === "network_interface") {
          control = el("select", { onchange: (e) => save(item.key, e.target.value) });
          control.appendChild(el("option", { value: val, text: val + " (current)" }));
          (interfaces || []).forEach((i) => control.appendChild(el("option", { value: i.address, text: i.name + " — " + i.address })));
        } else {
          control = el("input", {
            type: item.type === "password" ? "password" : "text",
            value: val,
            onchange: (e) => save(item.key, e.target.value),
          });
        }
        row.appendChild(control);
        section.appendChild(row);
      });
      root.appendChild(section);
    });
    app.appendChild(root);
  }
  function save(key, value) {
    vscode.postMessage({ type: "saveConfig", key, value });
  }

  // ---- run history -----------------------------------------------------------
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }
  function renderHistory(entries) {
    clear(app);
    const root = el("div", { class: "history" });
    const head = el("div", { class: "tool-header" });
    head.appendChild(el("h1", { text: "Run History" }));
    head.appendChild(el("div", { class: "crumbs", text: (entries.length || 0) + " run(s) — most recent first" }));
    root.appendChild(head);
    const bar = el("div", { class: "btn-row" });
    bar.appendChild(el("button", { class: "run-secondary", type: "button", text: "Clear history", onclick: () => vscode.postMessage({ type: "clearHistory" }) }));
    root.appendChild(bar);

    if (!entries || !entries.length) {
      root.appendChild(el("div", { class: "output-empty", text: "No runs yet — run a tool and it will appear here." }));
      app.appendChild(root);
      return;
    }

    const table = el("table", { class: "data-table" });
    const thead = el("thead");
    const htr = el("tr");
    ["Time", "Tool", "Action", "Mode", "Exit", "Command", ""].forEach((c) => htr.appendChild(el("th", { text: c })));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = el("tbody");
    entries.forEach((e) => {
      const tr = el("tr");
      tr.appendChild(el("td", { text: fmtTime(e.ts) }));
      const toolTd = el("td");
      toolTd.appendChild(el("a", { class: "file-link", href: "#", text: e.toolLabel, onclick: (ev) => { ev.preventDefault(); vscode.postMessage({ type: "openTool", toolId: e.toolId }); } }));
      tr.appendChild(toolTd);
      tr.appendChild(el("td", { text: e.actionLabel }));
      tr.appendChild(el("td", { text: e.mode }));
      const exit = e.exitCode === undefined || e.exitCode === null ? (e.mode === "terminal" ? "—" : "…") : String(e.exitCode);
      tr.appendChild(el("td", { text: exit }));
      const cmdTd = el("td");
      cmdTd.appendChild(el("code", { class: "hist-cmd", text: e.command }));
      tr.appendChild(cmdTd);
      const actTd = el("td", { class: "hist-actions" });
      actTd.appendChild(el("button", { class: "gate-btn", type: "button", text: "Re-run", onclick: () => vscode.postMessage({ type: "rerun", id: e.id }) }));
      if (e.outputFile) actTd.appendChild(el("button", { class: "gate-btn", type: "button", text: "Output", onclick: () => vscode.postMessage({ type: "openFile", path: e.outputFile }) }));
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    root.appendChild(el("div", { class: "table-scroll" }, [table]));
    app.appendChild(root);
  }

  // ---- message pump ----------------------------------------------------------
  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "showHome": renderHome(m); break;
      case "showTool": interfaces = m.interfaces || []; renderTool(m.tool, m.isFavorite); break;
      case "setTheme": document.body.dataset.theme = m.theme === "htb" ? "htb" : "adaptive"; break;
      case "favorite": {
        document.querySelectorAll('.fav-star[data-tool="' + m.id + '"]').forEach((btn) => {
          btn.classList.toggle("on", !!m.isFavorite);
          btn.textContent = m.isFavorite ? "★" : "☆";
          btn.title = m.isFavorite ? "Remove from favorites" : "Add to favorites";
        });
        break;
      }
      case "showConfig": renderConfig(m.groups, m.values, m.interfaces); break;
      case "showHistory": renderHistory(m.entries || []); break;
      case "resolved":
        for (const id in (m.commands || {})) {
          const c = m.commands[id];
          if (previewEls[id]) previewEls[id].textContent = c.command || "(empty command)";
          resolvedCmd[id] = c.command;
          outputFileByAction[id] = c.outputFile;
        }
        renderNotes(m.notes);
        applyFileWarnings(m.fileWarnings);
        break;
      case "running":
        if (m.inTerminal) {
          const out = outputNode();
          if (out) { clear(out); out.appendChild(el("div", { class: "run-status", text: "▸ Running in integrated terminal — see the Terminal panel." })); }
        } else {
          setRunning(true);
          startOutput(m.command);
        }
        break;
      case "output": appendLog(m.chunk); break;
      case "done": setRunning(false); finishOutput(m.code, m.table, m.outputFile); break;
      case "stopped": setRunning(false); { const s = document.getElementById("run-status"); if (s) { s.textContent = "Stopped."; s.className = "run-status err"; } } break;
      case "fieldValue": {
        const input = document.getElementById("f_" + m.fieldId);
        if (input) input.value = m.value;
        state[m.fieldId] = m.value;
        applyConditions();
        resolveAll();
        break;
      }
      case "gateStatus": renderGates(m); break;
    }
  });

  // Keyboard: Ctrl/Cmd+Enter runs the first visible, enabled action.
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      const btn = document.querySelector(".action-card:not(.hidden) button.run:not([disabled])");
      if (btn) { ev.preventDefault(); btn.click(); }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
