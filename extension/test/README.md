# Tests

Framework-free `tsx` scripts. `npm test` runs all three; they need no tools
installed and no network, so they run anywhere and in CI.

- `harness.ts` — the assertions (`eq`, `ok`, `fail`, `pass`, `skip`, `done`) and
  the pass/fail tally every script exits on. No imports from `src/`.
- `webview.ts` — drives `media/main.js` under **jsdom** with the same messages
  the host posts, and asserts on the DOM: the tool form's field markers and
  conditional fields, the missing-file warning, the home dashboard, and the
  config and history views. The only coverage the front-end has.
- `contributions.ts` — `package.json` wiring, which nothing else catches because
  it fails silently: every contributed command is registered (and vice versa),
  every setting read in code is declared, every walkthrough step has media and
  links to real commands, and the esbuild bundle builds and ships.
- `manifest.ts` — structural lint over every tool manifest: every `{token}` is a
  real field or config key, `when`/`section`/`parse` references resolve, `check`
  fields that are emitted have a `flag`, and ids are unique.

## Adding coverage

A new tool needs nothing here — `manifest.ts` picks it up from the registry. A
new config key likewise, via `CONFIG_KEYS`. Front-end changes need a case in
`webview.ts`: post the message the host would send, then assert on the DOM.
