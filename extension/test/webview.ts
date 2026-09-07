// Webview render tests. media/main.js is ~1000 lines of DOM building that the
// rest of the suite never touches — this drives it under jsdom, feeding it the
// same messages the host posts and asserting on what comes out. Offline, no VS
// Code, no binaries.
import * as fs from "fs";
import * as path from "path";
import { JSDOM } from "jsdom";
import { done, eq, ok } from "./harness";

const MAIN = path.join(__dirname, "..", "media", "main.js");
const dom = new JSDOM(`<!doctype html><body data-theme="adaptive"><div id="app"></div></body>`, {
  runScripts: "outside-only",
});
const { window } = dom;
const posted: any[] = [];
(window as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => posted.push(m) });
window.eval(fs.readFileSync(MAIN, "utf8"));

/** Post a message the way the host does. */
const send = (msg: unknown) => window.dispatchEvent(new window.MessageEvent("message", { data: msg }));
const $ = (sel: string) => window.document.querySelector(sel);
const $$ = (sel: string) => [...window.document.querySelectorAll(sel)];
const byId = (id: string) => window.document.getElementById(id);
const click = (el: Element | null | undefined) => el?.dispatchEvent(new window.Event("click"));
const appText = () => window.document.getElementById("app")!.textContent ?? "";
const lastPosted = (type: string, action?: string) =>
  posted.filter((m) => m.type === type && (!action || m.action === action)).pop();

// ── required / optional field markers ─────────────────────────────────────────
send({
  type: "showTool",
  isFavorite: false,
  interfaces: [{ name: "eth0", address: "10.0.0.5" }],
  tool: {
    id: "gobuster", label: "gobuster", category: "Web_App", deps: ["gobuster"], hasNotes: false,
    fields: [
      { id: "target", type: "text", label: "Target host", default: "box.htb", required: true },
      { id: "port", type: "port", label: "Port (optional)" },
      { id: "wordlist", type: "file", label: "Directory wordlist", default: "/home/u/.pentest-toolbox/wordlists/discovery-wordlist.txt", rootConfig: "WORDLISTS_DIR" },
      { id: "threads", type: "text", label: "Threads", default: "64" },
      { id: "timeout", type: "text", label: "Timeout (optional, -to)" },
    ],
    actions: [{ id: "dir", label: "Directory brute-force", mode: "captured" }],
  },
});

const label = (id: string) => $(`.field[data-field="${id}"] > label`)!;
eq("required fields carry a red asterisk", label("target").querySelector(".req")?.textContent, "*");
ok("a required field is not also marked optional", !label("target").querySelector(".opt"));
eq("optional fields say so", label("threads").querySelector(".opt")?.textContent, "optional");
// A manifest label ending in a bare "(optional)" is normalised into the marker…
eq("a bare (optional) in the label is not doubled up", label("port").textContent?.trim(), "Portoptional");
// …but one whose parenthetical carries more (the flag name) keeps it verbatim.
ok(
  "a label whose parens carry more than 'optional' is left alone",
  label("timeout").textContent!.includes("(optional, -to)") && !label("timeout").querySelector(".opt")
);
ok("the form asks the host to resolve its commands", posted.some((m) => m.type === "resolve"));

// ── missing-file warning ──────────────────────────────────────────────────────
send({
  type: "resolved",
  commands: { dir: { command: "sudo virt-install --disk path=/var/lib/libvirt/images/pwnbox.qcow2" } },
  notes: [],
  fileWarnings: [{ fieldId: "wordlist", path: "/var/lib/libvirt/images/pwnbox.qcow2" }],
});
const warning = $('.field[data-field="wordlist"] .field-warn');
ok("a missing file warns under its own field", !!warning);
ok("the warning names the file that is missing", !!warning?.textContent?.includes("pwnbox.qcow2"));
eq("only the offending field is flagged", $$(".field-warn").length, 1);

send({ type: "resolved", commands: { dir: { command: "x" } }, notes: [], fileWarnings: [] });
eq("the warning clears once the file is there", $$(".field-warn").length, 0);

// ── wordlists panel ───────────────────────────────────────────────────────────
const rows = [
  { remote: "rockyou.txt.tar.gz", label: "rockyou", description: "Default password list.", size: "51 MB", bytes: 53287424, extracted: "rockyou.txt", installed: false, configKey: "PASS_WORDLIST_FILE" },
  { remote: "discovery-wordlist.tar.gz", label: "Directory discovery", description: "Paths for gobuster.", size: "16 MB", bytes: 17272917, extracted: "discovery-wordlist.txt", installed: true, onDisk: "180 MB", configKey: "DIR_WORDLIST" },
  { remote: "lfi-wordlist.tar.gz", label: "LFI paths", description: "Traversal payloads.", size: "25 KB", bytes: 25603, extracted: "lfi-wordlist.txt", installed: false },
];
const panelState = (over: Record<string, unknown> = {}) => ({
  dir: "/home/u/.pentest-toolbox/wordlists", rows, offline: false, busy: false, ...over,
});
send({ type: "showCustom", panel: "wordlists", label: "Wordlists", state: { action: "state", state: panelState() } });

eq("every wordlist is listed", $$(".wl-row").length, 3);
eq("the target directory is shown", byId("wl-dir")?.textContent, "/home/u/.pentest-toolbox/wordlists");
eq("each row shows its download size", $$(".wl-size").map((e) => e.textContent).join(","), "51 MB,16 MB,25 KB");
ok("an already-downloaded list is marked", $('.wl-row[data-remote="discovery-wordlist.tar.gz"]')!.className.includes("installed"));
ok("…and shows what it takes on disk", $('.wl-row[data-remote="discovery-wordlist.tar.gz"]')!.textContent!.includes("180 MB"));
eq("lists backing a config key are tagged", $$(".wl-tag").map((e) => e.textContent).sort().join(","), "DIR_WORDLIST,PASS_WORDLIST_FILE");
eq("nothing is selected to begin with", byId("wl-summary")?.textContent, "Nothing selected.");
eq("downloading is disabled with an empty selection", (byId("wl-download") as HTMLButtonElement).disabled, true);

const bulk = (name: string) => $$(".wl-bulk button").find((b) => b.textContent === name);
click(bulk("Select all"));
eq("select all checks every row", $$(".wl-check:checked").length, 3);
// The whole point of the panel: the cost is visible before the click.
eq("the footer totals the selection", byId("wl-summary")?.textContent, "3 selected · 67 MB to download");
eq("the button repeats the total", byId("wl-download")?.textContent, "Download selected (67 MB)");

click(bulk("Select recommended"));
eq("recommended picks the config-backed lists", $$(".wl-check:checked").map((c) => (c as HTMLElement).dataset.remote).sort().join(","), "discovery-wordlist.tar.gz,rockyou.txt.tar.gz");
click(bulk("Select missing"));
eq("missing picks what is not on disk", $$(".wl-check:checked").map((c) => (c as HTMLElement).dataset.remote).sort().join(","), "lfi-wordlist.tar.gz,rockyou.txt.tar.gz");

click(byId("wl-download"));
eq("download asks the host for exactly the selection", lastPosted("customAction", "download")?.payload.names.sort().join(","), "lfi-wordlist.tar.gz,rockyou.txt.tar.gz");

// ── download progress ─────────────────────────────────────────────────────────
const progress = (state: Record<string, unknown>) => send({ type: "customResult", action: "progress", state });
progress({ remote: "rockyou.txt.tar.gz", received: 26643712, total: 53287424, fraction: 0.5, rate: 3145728, etaSeconds: 8.5, phase: "downloading" });
const bar = byId("wl-bar-rockyou.txt.tar.gz")!;
const prog = byId("wl-prog-rockyou.txt.tar.gz")!;
ok("the progress bar appears on the first event", !bar.className.includes("hidden"));
eq("the bar fills to the fraction", (byId("wl-fill-rockyou.txt.tar.gz") as HTMLElement).style.width, "50%");
eq("progress reads percent, bytes, rate and ETA", prog.textContent, "50% · 25 MB / 51 MB · 3.0 MB/s · ~9s left");

progress({ remote: "rockyou.txt.tar.gz", received: 0, phase: "downloading" });
ok("no Content-Length sweeps instead of freezing at 0%", bar.className.includes("indeterminate"));
progress({ remote: "rockyou.txt.tar.gz", received: 1, phase: "extracting" });
ok("extraction is reported and stops the sweep", prog.textContent === "extracting…" && !bar.className.includes("indeterminate"));
progress({ remote: "rockyou.txt.tar.gz", received: 1, fraction: 1, phase: "failed", message: "connection timed out" });
ok("a failure shows on the bar with its reason", bar.className.includes("failed") && prog.textContent === "connection timed out");

send({ type: "customResult", action: "state", state: panelState({ rows: rows.map((r) => ({ ...r, installed: true })) }), message: "Downloaded 2 wordlists." });
eq("the list re-renders when the run finishes", $$(".wl-row.installed").length, 3);
ok("the outcome is reported", !!byId("custom-output")?.textContent?.includes("Downloaded 2 wordlists."));

// ── host-mode banner ──────────────────────────────────────────────────────────
const home = (over: Record<string, unknown> = {}) =>
  send({ type: "showHome", stats: { toolCount: 22, categoryCount: 6, runCount: 0 }, categories: [], config: [], quickTools: [], recent: [], ...over });
home({ host: { mode: "host", name: "Fedora Linux 44", shown: 22, total: 92 } });
ok("host mode banners the dashboard", !!$(".host-banner"));
ok("the banner names the distro and what is hidden", $(".host-banner")!.textContent!.includes("Fedora Linux 44") && $(".host-banner")!.textContent!.includes("22 of 92"));
click($(".host-banner button"));
ok("the banner offers to show everything", posted.some((m) => m.type === "showAllTools"));
home();
ok("no banner on an attack box", !$(".host-banner"));

// ── the views these changes touch in passing ──────────────────────────────────
send({
  type: "showConfig",
  groups: [{ title: "Libvirt", items: [
    { label: "Connection URI", key: "LIBVIRT_URI", type: "text", validation: "required" },
    { label: "Images directory", key: "IMAGES_DIR", type: "path", validation: "required" },
    { label: "Default network", key: "DEFAULT_NET", type: "text", validation: "optional" },
  ] }],
  values: { LIBVIRT_URI: "qemu:///system", IMAGES_DIR: "/var/lib/libvirt/images", DEFAULT_NET: "" },
  interfaces: [],
});
eq("config marks required keys as required", $$(".field > label .req").length, 2);
eq("config marks optional keys", $$(".field > label .opt").length, 1);
send({ type: "showHistory", entries: [] });
ok("run history still renders", appText().includes("Run History"));
send({ type: "showCustom", panel: "email", label: "Email Analyzer" });
ok("the email panel still renders", appText().includes("Analyze email"));

done();
