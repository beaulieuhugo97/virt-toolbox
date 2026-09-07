# Tests

Two layers, both framework-free `tsx` scripts.

## Offline — `npm test`  (no tools, runs anywhere / CI)
- `kape.ts`, `email.ts` — the custom panels' pure parsers.
- `parsers.ts` — the `parse:` table parsers (nmap, gobuster, whatweb), against
  verbatim samples of each tool's real output. Prose lines, ANSI colour and
  commas inside brackets are what a naive regex trips over, so the fixtures keep
  them.
- `wordlists.ts` — the wordlist catalog and manager: the extracted-name
  prediction the "already downloaded" state depends on, size formatting, and the
  on-disk manifest the `vscode:uninstall` hook reads. Network-free.
- `host.ts` — host-mode detection from `/etc/os-release` (Parrot's several
  spellings, Kali, Debian derivatives, Fedora/Arch), and that the host-safe tool
  list names tools that exist.
- `webview.ts` — drives `media/main.js` under **jsdom** with the same messages
  the host posts, and asserts on the DOM: field markers, the missing-file
  warning, the wordlists panel and its progress bars, the host-mode banner. The
  only coverage the front-end has.
- `uninstall.ts` — runs the real `vscode:uninstall` hook in a subprocess against
  a throwaway `HOME`. It deletes files with nothing around to confirm, so the
  cases are mostly about what it must **not** touch: a hand-added wordlist, a
  `../../` path in the manifest, an opt-out, a corrupt or future-version
  manifest.
- `install.ts` — sources the `install` script (it guards `main` on being
  executed) and drives its functions against `/etc/os-release` fixtures: the
  Parrot/Kali/Debian/Fedora/Arch branches, that package-manager commands stay
  word-split under strict-mode `IFS`, and that a prompt with no terminal takes a
  default instead of hanging — never "yes" for a destructive one.
- `contributions.ts` — `package.json` wiring, which nothing else catches because
  it fails silently: every contributed command is registered (and vice versa),
  every setting read in code is declared, every walkthrough step has media and
  links to real commands, and the uninstall hook is built and shipped.
- `manifest.ts` — structural lint over every tool manifest: every `{token}` is a
  real field or config key, `when`/`section`/`parse` references resolve, `check`
  fields that are emitted have a `flag`, ids are unique. Also a **staleness guard**:
  fails if `run-cases.json` is out of date (re-run `npm run test:extract`).

## Real commands — `npm run test:syntax:docker`  (catches tool syntax changes)
Runs every tool's **actual command** against localhost targets inside a ParrotOS
container (`test/docker/`), which is both attack box and target. A tool that no
longer accepts a flag we use prints an arg-parse error → the run fails.

Pipeline:
1. **Extract once** — `npm run test:extract` resolves every action (localhost test
   config + auto-derived field defaults + recipe overrides) into the committed
   `run-cases.json`. Regenerate whenever tools change.
2. **Run** — `test/run-commands.ts` reads only `run-cases.json` (no resolver/vscode),
   probes each case's binary + `needs` targets (missing ⇒ SKIP), runs the command,
   and asserts: no `ARG_ERRORS`, plus any `expect` markers. `npm run test:syntax`
   runs it locally (skips whatever isn't installed); the `:docker` variant brings up
   the targets and runs it fully.

## Adding coverage
Add a line to `recipes.ts` (`R(tool, action, { state, needs, expect })`) — never a
command string; the resolver produces that. Then `npm run test:extract`. Windows/AD,
hardware, cloud, and interactive tools are skipped by name in `recipes.ts` with a
reason (see the `skip:` counts printed by `test:extract`).
