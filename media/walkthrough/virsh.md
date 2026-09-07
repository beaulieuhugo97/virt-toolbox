# Manage your VMs

The **virsh** tool lists and controls your libvirt/KVM virtual machines:

- **Manage** — list, start, shutdown, suspend/resume, reboot, force-reset, force-stop and delete a VM.
- **Snapshots** — list, create, revert and delete snapshots.

The **libvirtd** badge shows whether the hypervisor service is running; a **Start**
button appears when it is stopped. Every action runs in a real terminal so the
`sudo` password prompt works.

Need an image or a fresh VM? Open **Images & VM creation** to download an ISO,
create a VM with `virt-install`, or import an existing qcow2 disk.
