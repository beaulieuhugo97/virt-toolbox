# Changelog

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
