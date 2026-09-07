# Changelog

## Unreleased

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
