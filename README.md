# Virtualization Toolbox

A VS Code extension for driving **libvirt/KVM** and **docker** from guided forms —
manage `virsh` VMs, create them with `virt-install`, snapshot them, wire up libvirt
networks, and spin throwaway containers. Meant for the machine that hosts your lab
VMs.

Spun out of [pentest-toolbox](https://github.com/beaulieuhugo97/pentest-toolbox);
it reuses that project's data-driven form engine.

- **`extension/`** — the VS Code extension (see [extension/README.md](extension/README.md)).
- **`scripts/`** — the original bash TUI the tools were ported from (the reference).

## Install (from source)

```bash
cd extension
npm install
npm run package        # produces extension/virt-toolbox.vsix
code --install-extension virt-toolbox.vsix
```

## License

See [LICENSE.md](LICENSE.md).
