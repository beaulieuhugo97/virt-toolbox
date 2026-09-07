// Shared test utilities: a micro-assertion harness, free of any import from
// src/ so every test script can use it without pulling in vscode.
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
