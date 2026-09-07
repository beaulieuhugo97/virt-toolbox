// Shared test utilities. Deliberately free of any import from src/ so the runner
// (test/run-commands.ts) can use it inside the Docker container with only
// test/run-cases.json — no resolver, no vscode.

// ── Micro-assertion harness (was test/_assert.ts) ────────────────────────────
let failures = 0;
let passes = 0;
let skips = 0;

/** Deep-equality assert (JSON compare). Logs got/want on mismatch. */
export function eq(name: string, got: unknown, want: unknown): void {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${good ? "PASS" : "FAIL"}  ${name}`);
  if (!good) {
    console.log("   got :", JSON.stringify(got));
    console.log("   want:", JSON.stringify(want));
    failures++;
  } else {
    passes++;
  }
}

/** Boolean assert. */
export function ok(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  cond ? passes++ : failures++;
}

/** Record an explicit failure with an optional detail line. */
export function fail(name: string, detail?: string): void {
  console.log(`FAIL  ${name}`);
  if (detail) {
    console.log("   ", detail);
  }
  failures++;
}

/** Record a pass without a comparison (e.g. a loop that found no problems). */
export function pass(name: string): void {
  console.log(`PASS  ${name}`);
  passes++;
}

/** Record a skipped check (e.g. a tool binary or target that isn't available). */
export function skip(name: string, why?: string): void {
  console.log(`SKIP  ${name}${why ? `  (${why})` : ""}`);
  skips++;
}

/** Print a summary line and exit 0 (all green) or 1 (any failure). */
export function done(): never {
  const parts = [`${passes} passed`];
  if (skips) {
    parts.push(`${skips} skipped`);
  }
  parts.push(`${failures} failed`);
  console.log(`\n${failures === 0 ? "ALL GREEN" : "FAILURES"} — ${parts.join(", ")}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Where setup-targets.sh seeds fixtures (sample ISOs and disk images) in the container. */
export const FX = process.env.TOOLBOX_FX || "/root/fx";

/**
 * Config the extractor points every tool at: a throwaway session libvirt instance
 * and the seeded image fixtures, so nothing touches the real system hypervisor.
 * The resolver bakes these into runnable commands.
 */
export const TEST_CONFIG: Record<string, string> = {
  LIBVIRT_URI: "qemu:///session",
  IMAGES_DIR: `${FX}/images`,
  DEFAULT_NET: "virbr0",
};

/**
 * The heart of the check: phrases a CLI arg-parser emits when it no longer
 * accepts a flag/subcommand we use. Applied to every run (a removed flag => the
 * real tool prints one of these => the test fails). Kept tight to avoid matching
 * a tool's legitimate output.
 */
export const ARG_ERRORS: string[] = [
  "unrecognized option",
  "unrecognized arguments",
  "unrecognized command",
  "invalid option",
  "unknown option",
  "unknown flag",
  "no such option",
  "invalid choice",
  "not a recognized",
  "command not found",
  "unknown argument",
  "unexpected argument",
  "Invalid argument", // certipy/argparse-style
];

/** A named target/fixture a case needs, and the shell probe that tells us it's up. */
export const NEEDS: Record<string, string> = {
  ssh: "nc -z 127.0.0.1 22",
  ftp: "nc -z 127.0.0.1 21",
  http: "nc -z 127.0.0.1 80",
  smb: "nc -z 127.0.0.1 445",
  ldap: "nc -z 127.0.0.1 389",
  mysql: "nc -z 127.0.0.1 3306",
  postgres: "nc -z 127.0.0.1 5432",
  dns: "nc -z 127.0.0.1 53",
  fx: `test -f ${FX}/.ready`,
  // Variant gate: john's commands need the jumbo build (mirrors the tool's verify).
  jumbo: "john 2>&1 | grep -qi jumbo",
  moto: "nc -z 127.0.0.1 5000",       // AWS mock (moto_server)
  sqlmapapp: "nc -z 127.0.0.1 8081",  // injectable php app
  dc: "nc -z 127.0.0.1 88",           // Samba AD DC (KDC) — gates the AD tools
};

const NOISE = new Set([
  "sudo", "echo", "cd", "test", "[", "printf", "true", "false", "mkdir", "rm",
  "cat", "tee", "export", "ls", "cp", "mv", "pyenv", "PYENV_VERSION", "for", "do",
  "done", "if", "then", "fi", "while", "(", "{",
]);

/**
 * Best-effort "which binary does this command actually invoke" — the first real
 * token across `&&`/`|`/`;`-separated segments, skipping shell noise and leading
 * VAR= assignments. Used to `command -v` before running (missing => SKIP, not a
 * false failure). Recipes can override via `bin`.
 */
export function primaryBinary(command: string): string {
  for (const seg of command.split(/&&|\|\||[|;]/)) {
    const tokens = seg.trim().split(/\s+/);
    for (let t of tokens) {
      if (!t) continue;
      if (/^[A-Z_][A-Z0-9_]*=/.test(t)) continue; // env assignment
      t = t.replace(/^['"]|['"]$/g, "");
      const base = t.includes("/") ? t.slice(t.lastIndexOf("/") + 1) : t;
      if (NOISE.has(t) || NOISE.has(base)) break; // noisy segment — try the next one
      return base;
    }
  }
  return command.trim().split(/\s+/)[0] ?? "";
}
