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
    id: "virt-create", label: "Create", category: "Virtual_Machines", deps: ["virt-install"], hasNotes: false,
    fields: [
      { id: "target", type: "text", label: "VM name", default: "pwnbox", required: true },
      { id: "port", type: "port", label: "Port (optional)" },
      { id: "wordlist", type: "file", label: "Installer ISO", default: "/var/lib/libvirt/images/parrot.iso", rootConfig: "IMAGES_DIR" },
      { id: "threads", type: "text", label: "vCPUs", default: "8" },
      { id: "timeout", type: "text", label: "Timeout (optional, -to)" },
    ],
    actions: [{ id: "dir", label: "Create VM from ISO", mode: "captured" }],
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

// ── home dashboard ────────────────────────────────────────────────────────────
send({
  type: "showHome",
  stats: { toolCount: 4, categoryCount: 3, runCount: 7 },
  categories: [{ name: "Virtual_Machines", count: 2 }],
  config: [{ label: "Connection URI (LIBVIRT_URI)", value: "qemu:///system" }],
  quickTools: [{ id: "virsh", label: "Manage" }],
  recent: [],
});
eq("the dashboard counts tools, categories and runs", $$(".stat-n").map((e) => e.textContent).join(","), "4,3,7");
ok("the config card shows the resolved libvirt URI", appText().includes("qemu:///system"));
click($$(".home-link").find((b) => b.textContent!.includes("Configuration")));
ok("the Configuration link opens the config view", posted.some((m) => m.type === "openConfig"));


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

done();
