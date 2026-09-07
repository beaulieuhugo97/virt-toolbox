# Changelog

## Unreleased

### Changed — how libvirt tools reach libvirt

**This changes the access model.** Every virsh action used to run `sudo virsh` in a
terminal. It now runs `{VIRSH_BIN}` — a new config key defaulting to plain `virsh` —
and the tools gate on membership of the **libvirt** group, whose polkit rule grants
read *and* write access to `qemu:///system` with no password. That is what makes
sortable tables possible: a captured run gets a stdin pipe and never a TTY, so a
`sudo` password prompt would hang forever.

- If you are **in the libvirt group**, everything works unprivileged, writes included.
- If you are **not**, use the **Add me** badge and log back in. Do not set `VIRSH_BIN`
  to plain `sudo virsh` — captured listings would hang on a password prompt nobody can
  answer. Use `sudo -n virsh` with a NOPASSWD rule instead (the tool notes carry the
  one-liner).
- `service: "libvirtd"` is gone. libvirtd is deprecated and the modular daemons that
  replaced it are socket-activated, so `systemctl is-active` reported "inactive" on a
  perfectly working host and the badge's Start button targeted a retired unit. Two
  probes that actually call `virsh` replace it.
- `virt-viewer` and `virt-install` no longer run under `sudo`, which also fixes them
  on Wayland: a GUI spawned as root has no access to the user's display session.
- Creating or importing a VM now defaults its graphical console to
  `listen=127.0.0.1` instead of `0.0.0.0`, which previously exposed an
  unauthenticated console to anyone who could reach the host. `0.0.0.0` is still
  available as an explicit choice.
- What still needs root is unchanged and still runs in a terminal: downloading into
  the root-owned images directory, and the `iptables` / `sysctl` actions.

### Added

- **VM snapshots** — promoted out of the virsh tool's tab into its own tool: list as a
  table or a tree, create with disk-only / quiesce / atomic / halt / live, revert with
  a target run state, delete with or without children, set current, edit XML.
- **VM hardware & devices** — block devices and interfaces as tables, attach/detach
  disks and NICs, change CD-ROM media, resize a disk, set vCPUs and memory against
  config or live, and per-device statistics.
- **Storage pools & volumes** — the first coverage of libvirt storage: pools with
  capacity and allocation, start/stop/refresh/autostart, define-and-build, volume
  list/info/create/resize/clone/upload/download, and armed deletion.
- **Host & capabilities** — libvirt and hypervisor versions, host CPU and memory, host
  and guest capabilities, CPU models, NUMA free pages, and host devices for passthrough.
  Read-only, so it needs no group membership.
- **virsh** gained autostart, save/restore, managed save, serial console, domain
  statistics, display URI, guest-agent info, define-from-XML, transient create, rename
  and description, plus a two-step armed delete for removing a VM's disks.
- **virsh networks** gained autostart, undefine, XML dump and edit, a Ports tab, and
  unprivileged reads (`sysctl`, `ip route`, `ip -br addr`) beside the root-only
  `iptables` actions.
- **Images & VM creation** gained a Library tab that lists the pool's images through
  libvirt — the images directory is `drwx--x--x root`, so `ls` fails unprivileged and
  this is the only way to see what is in it — plus `--print-xml` dry runs.
- **Sortable tables for virsh.** virsh has no machine-readable output, so listings are
  parsed from the header row's column offsets. One parser serves every virsh table,
  inferring columns at parse time, so a flag that adds a column needs no code change.
- `VIRSH_BIN` and `VIRT_INSTALL_BIN` config keys.
- Manifest lints for the two failure classes this release could have introduced: an
  action reading a field from another tab (which resolves to `""` and silently drops
  an argument), and `sudo` inside a captured action (which would hang).

- **Docker containers** — the throwaway-container tool grew into a full lifecycle
  tool: list, start/stop/restart/pause/kill, exec a shell, attach, follow logs,
  live stats, processes, published ports, filesystem diff, copy a path out,
  inspect to a JSON file, remove, stop-all and prune. Running a throwaway
  container is now its Run tab, with ports, env, bind-mount and privileged flags.
- **Docker images** — list, layer history, inspect, pull, tag, push, registry
  login, build from a Dockerfile, save/load a tar, disk usage, and pruning.
- **Docker networks** — list/inspect, containers on a network, create bridge /
  macvlan / ipvlan / overlay networks with subnet, gateway and IP range, connect
  and disconnect containers, remove and prune.
- **Docker volumes** — list/inspect, which containers use a volume and its size on
  disk, create, remove, prune, and back up / restore through a helper container.
- **Docker Compose** — up/down (optionally deleting volumes), service status,
  per-service start/stop/restart/build/pull/exec/run, follow or capture logs, the
  merged config, images and processes.
- **Sortable tables** — docker listings run captured and are parsed into real
  sortable tables rather than raw terminal text. Parsers are keyed by output
  shape, so one `docker.ps` parser serves four tools.
- **Configuration** — a `DOCKER_BIN` key (default `docker`) sets the CLI every
  docker tool invokes, so `podman`, `nerdctl` or `sudo -n docker` work throughout.
- Gate probes are now time-boxed and resolve `{CONFIG}` tokens, so a `verify`
  command can reference `DOCKER_BIN` and one blocking probe can no longer leave a
  tool with no badges at all.

## 1.0.0

Initial release.

- **virsh** — VM lifecycle (list, start, stop, suspend, resume, reboot, force-reset,
  destroy, delete) and snapshots (list, create, revert, delete).
- **Images & VM creation** — download an image (Parrot, Kali, VirtIO drivers or a
  custom URL; archives are extracted and removed), create a VM from an ISO via
  `virt-install` (with an optional VirtIO CD for Windows), import an existing disk.
  Windows guests get the setup instructions the bash TUI carried.
- **virsh networks** — list/inspect, create NAT / host-only / isolated networks,
  start/stop/destroy, DHCP leases, IP forwarding.
- **docker** — run a throwaway container on the host network.
- **Configuration** — the libvirt connection URI, images directory and default
  network, injected into every tool's command.

Runs execute in `~/.virt-toolbox/outputs/<tool>/`; set `virtToolbox.outputsPath`
to put them somewhere else.
