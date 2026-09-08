# Manage your VMs

The **Manage** tool, under *Virtual_Machines*, lists and controls your
libvirt/KVM virtual machines:

- **Manage** — list, start, shutdown, suspend/resume, reboot, force-reset, autostart,
  save/restore, the serial console and the graphical viewer.
- **Inspect** — VM info, live statistics, display URI and the domain XML.
- **XML & config** — edit, define, rename and describe a VM.
- **Delete** — undefine a VM, optionally with its disks.

Listings run **captured** and render as sortable tables: click a column header to
sort. Every action that changes something re-runs the listing afterwards, so the
table you are looking at is the state you just created.

Two badges tell you whether it will work: **virsh CLI** and **hypervisor
reachable**. Both probe `virsh` itself rather than a systemd unit, because modern
libvirt uses socket-activated modular daemons that report "inactive" while working
perfectly. If **libvirt group** is red, use its **Add me** button and log back in —
group membership is what grants unprivileged access, for writes as well as reads.

Snapshots have their own tool now, alongside **Hardware**, **Networks**,
**Pools** and **Volumes** — and the hypervisor itself is under *Host* ▸ **Info**.
Need an image or a fresh VM? Open **Images**, then **Create**.
