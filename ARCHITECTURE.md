# Architecture

How the extension is put together, and where to change things.

## Tools are data, not code

Every tool is a plain object in [`src/tools/virtualization.tools.ts`](src/tools/virtualization.tools.ts) —
metadata, form fields, and command templates — typed by the schema in
[`src/types.ts`](src/types.ts). One generic form engine renders any of them, so
there is no per-tool UI code. Adding a tool means adding a manifest entry.

| Category | Tool | What it does |
| --- | --- | --- |
| Virtual Machines | **virsh** | List, start/stop, suspend/resume, reboot, force-reset, destroy and delete VMs; list / create / revert / delete snapshots. |
| Virtual Machines | **Images & VM creation** | Download an ISO/qcow2 into the images dir, create a VM from an ISO with `virt-install` (VirtIO CD for Windows), or import an existing disk. |
| Networking | **virsh networks** | List/inspect networks, create NAT / host-only / isolated networks (`net-define`), start/stop/destroy, DHCP leases, and IP-forwarding rules. |
| Container | **Docker containers** | Run a throwaway container, then list/start/stop/restart/kill, exec a shell, follow logs, stats, copy files out, inspect and remove. |
| Container | **Docker images** | List, pull, tag, push, build from a Dockerfile, layer history, save/load a tar, disk usage and pruning. |
| Container | **Docker networks** | List/inspect, create bridge / macvlan / ipvlan / overlay networks, connect and disconnect containers, remove and prune. |
| Container | **Docker volumes** | List/inspect, see which containers use one and its size, create, remove, and back up / restore through a helper container. |
| Container | **Docker Compose** | Up/down a stack, per-service start/stop/restart/build/pull/exec, service status, logs and the merged config. |

## The host owns the command

The webview never builds or sees a raw command. It posts field state to the host;
[`src/template/resolver.ts`](src/template/resolver.ts) resolves the template
against that state plus config, and returns one string that is *both* what the
preview displays and what executes. That keeps the "a GUI hides what it runs"
problem closed.

Resolution details worth knowing:

- **`{token}`** interpolates a field id or a config key. Substitution repeats to a
  bounded fixpoint, so a field whose value itself contains a token (`cDiskPath`
  defaults to `{IMAGES_DIR}/{cVmName}.qcow2`) resolves fully.
- **`[[ … ]]`** is an optional group: it renders only if every token inside it is
  non-empty. This is how a flag that should vanish when its field is blank works
  without per-tool code.
- **Hidden fields resolve to `""`.** Visibility cascades through `when`, computed
  to a fixpoint. The download form leans on this: `{dlPreset}{dlUrl}` is whichever
  of the two is currently shown.
- Values are normalised by type — `file` paths are shell-quoted, `check` emits its
  `flag`, `password`/`textarea` escape embedded quotes.

## Gates

Before a tool can run, the host probes what it needs and badges the result:
missing binaries (`deps`), a stopped systemd service (`service`, with a **Start**
button), and group membership (`group`, with an **Add me** button). Nothing is
blocked — the badge tells you what to fix.

## Execution

libvirt and `virt-install` need root and are interactive, so those actions run in
a real VS Code terminal where the `sudo` prompt works (`mode: "terminal"`). The
The docker tools instead run their listings in `mode: "captured"` — collect stdout,
run it through a parser, render a sortable table. Each listing is a `--format` Go
template paired with a parser id from [`src/parsers/index.ts`](src/parsers/index.ts),
keyed by output *shape* rather than by tool, so one `docker.ps` parser serves the
containers, networks, volumes and compose tools alike. Anything needing a TTY
(`run -ti`, `exec`, `logs -f`, `build`, `pull`, `compose up`) stays on a terminal —
as does every `prune`, so docker's own `[y/N]` can be answered.

Each run executes in `<outputsPath>/<tool>/`, default `~/.virt-toolbox/outputs/`.
This matters beyond tidiness: a command may use `$PWD` (docker mounts it).

## Layout

```
src/config/      the shared config store + the settings form definition
src/tools/       the tool manifests — the data that drives everything
src/template/    command resolution (the single authority on what runs)
src/registry/    tool lookup + the serialized view sent to the webview
src/webview/     the host half: sessions, messages, gates
src/exec/        process spawning, capture, terminal handoff
media/main.js    the webview front-end — one form engine, no per-tool code
test/            see test/README.md
```

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # offline: webview render, contribution wiring, manifest lint
npm run build       # esbuild → out/extension.js
npm run package     # vsce → virt-toolbox.vsix
```

Press **F5** for an Extension Development Host; the launch config in `.vscode/`
builds first.
