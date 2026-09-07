// package.json wiring. Contributions are declared in one file and consumed in
// another, so nothing catches a walkthrough step pointing at a command that was
// never registered, or a setting read in code but never declared — it just
// silently does nothing at runtime. This checks both directions.
import * as fs from "fs";
import * as path from "path";
import { done, fail, ok, pass } from "./harness";

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const activation = fs.readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
const srcFiles = walk(path.join(ROOT, "src")).filter((f) => f.endsWith(".ts"));
const allSource = srcFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

// ── commands ──────────────────────────────────────────────────────────────────
const declared = new Set<string>(pkg.contributes.commands.map((c: any) => c.command));
const registered = new Set([...activation.matchAll(/registerCommand\(\s*"([^"]+)"/g)].map((m) => m[1]));

for (const cmd of declared) {
  if (!registered.has(cmd)) fail(`command '${cmd}' is contributed but never registered in extension.ts`);
}
pass("every contributed command is registered");
for (const cmd of registered) {
  if (!declared.has(cmd)) fail(`command '${cmd}' is registered but not contributed (invisible in the palette)`);
}
pass("every registered command is contributed");

// Commands referenced from menus and keybindings must exist too.
for (const group of Object.values<any[]>(pkg.contributes.menus)) {
  for (const item of group) {
    if (!declared.has(item.command)) fail(`menu references unknown command '${item.command}'`);
  }
}
for (const kb of pkg.contributes.keybindings ?? []) {
  if (!declared.has(kb.command)) fail(`keybinding references unknown command '${kb.command}'`);
}
pass("menus and keybindings reference real commands");

// ── settings ──────────────────────────────────────────────────────────────────
const settings = new Set(Object.keys(pkg.contributes.configuration.properties));
const read = new Set(
  [...allSource.matchAll(/getConfiguration\("virtToolbox"\)\s*\.?\s*(?:\r?\n\s*)?\.?get<[^>]*>\(\s*"([^"]+)"/g)].map((m) => m[1])
);
for (const key of read) {
  if (!settings.has(`virtToolbox.${key}`)) {
    fail(`setting 'virtToolbox.${key}' is read in code but not declared in package.json`);
  }
}
pass("every setting read in code is declared");
ok("the theme setting is declared", settings.has("virtToolbox.theme"));
ok("the autoOpenHome setting is declared", settings.has("virtToolbox.autoOpenHome"));

// ── walkthrough ───────────────────────────────────────────────────────────────
const steps = pkg.contributes.walkthroughs[0].steps;
for (const step of steps) {
  const media = step.media?.markdown;
  if (!media) {
    fail(`walkthrough step '${step.id}' has no media`);
    continue;
  }
  if (!fs.existsSync(path.join(ROOT, media))) fail(`walkthrough step '${step.id}' points at a missing file: ${media}`);
  // Every command: link in a step description or its markdown must be real.
  const body = step.description + fs.readFileSync(path.join(ROOT, media), "utf8");
  for (const m of body.matchAll(/command:(virtToolbox\.[A-Za-z]+)/g)) {
    if (!declared.has(m[1])) fail(`walkthrough step '${step.id}' links to unknown command '${m[1]}'`);
  }
  for (const ev of step.completionEvents ?? []) {
    const cmd = ev.replace(/^onCommand:/, "");
    if (ev.startsWith("onCommand:") && !declared.has(cmd)) {
      fail(`walkthrough step '${step.id}' completes on unknown command '${cmd}'`);
    }
  }
}
pass("every walkthrough step has media and links to real commands");

// ── build wiring ──────────────────────────────────────────────────────────────
// esbuild must emit the extension bundle, and .vscodeignore must not strip it.
const esbuild = fs.readFileSync(path.join(ROOT, "esbuild.js"), "utf8");
ok("esbuild builds the extension bundle", esbuild.includes("out/extension.js"));
ok("its source exists", fs.existsSync(path.join(ROOT, "src", "extension.ts")));
const ignore = fs.readFileSync(path.join(ROOT, ".vscodeignore"), "utf8");
ok("out/ is not excluded from the VSIX", !/^out\b/m.test(ignore));

done();
