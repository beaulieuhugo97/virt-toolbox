# Virtualization Toolbox

Drive **libvirt/KVM** and **docker** from guided VS Code forms. Pick a tool, fill
in a short form, review the *exact* command the toolbox will run, then run it in a
real terminal. Built for the machine that **hosts** your lab VMs (Fedora, Arch,
Ubuntu, Debian — anything with libvirt).

## Tools

| Category | Tool | What it does |
| --- | --- | --- |
| Virtual Machines | **virsh** | List, start/stop, suspend/resume, reboot, force-reset, destroy and delete VMs; list / create / revert / delete snapshots. |
| Virtual Machines | **Images & VM creation** | Download an ISO/qcow2 into the images dir, create a VM from an ISO with `virt-install` (VirtIO CD for Windows), or import an existing disk. |
| Networking | **virsh networks** | List/inspect networks, create NAT / host-only / isolated networks (`net-define`), start/stop/destroy, DHCP leases, and IP-forwarding rules. |
| Container | **docker** | Spin a throwaway `parrotsec/security` or `kalilinux/kali-rolling` container on the host network. |

## How it works

Every tool is **pure data** — metadata + form fields + command templates — rendered
by one generic form engine (no per-tool UI). The webview never sees the raw command:
the host resolves and previews the exact string, and that same string is what runs.
libvirt/virsh actions need root and are interactive, so they run in a real VS Code
terminal where the `sudo` prompt works.

- **Service gate** — `virsh`/`virt-*` badge whether **libvirtd** is running, with a
  Start button.
- **Group gate** — `docker` badges whether you are in the `docker` group, with an
  Add-me button.

## Develop

```bash
cd extension
npm install
npm run typecheck   # tsc --noEmit
npm test            # offline: manifest lint, webview render, contribution wiring
npm run build       # esbuild → out/extension.js
npm run package     # vsce → virt-toolbox.vsix
```

Open the **repo root** (not `extension/`) in VS Code and press **F5** to launch an
Extension Development Host — the launch config in `.vscode/` builds first, then
points the host at `extension/`.

The original bash TUI these tools were ported from lives in
`scripts/Tools/Virtualization/` and remains the reference.
