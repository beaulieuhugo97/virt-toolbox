// esbuild bundler for the extension host code.
// The webview front-end (media/*) is plain JS/CSS and is NOT bundled — it is
// loaded directly from disk via webview.asWebviewUri.
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const ENTRIES = [{ in: "src/extension.ts", out: "out/extension.js" }];

async function main() {
  const contexts = await Promise.all(
    ENTRIES.map((e) =>
      esbuild.context({
        entryPoints: [e.in],
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "node18",
        outfile: e.out,
        external: ["vscode"],
        sourcemap: !production,
        minify: production,
        logLevel: "info",
      })
    )
  );

  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("[esbuild] watching…");
  } else {
    await Promise.all(contexts.map(async (c) => {
      await c.rebuild();
      await c.dispose();
    }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
