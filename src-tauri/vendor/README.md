# GLib security backport

`glib-0.18.5/` is the complete crates.io `glib` 0.18.5 source archive, with the upstream `VariantStrIter::impl_get` correction backported.
The only changed upstream file is `src/variant_iter.rs`: the output pointer is mutable and passed as `&mut p` to `g_variant_get_child`.
The upstream version and generated manifest remain unchanged.
The MIT license is retained in `glib-0.18.5/LICENSE`.

- Source archive: https://static.crates.io/crates/glib/glib-0.18.5.crate
- Archive SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`
- Upstream correction: https://github.com/gtk-rs/gtk-rs-core/pull/1343
- Upstream merge: `05dff0ee696f9bcd8617cd48c4b812d046d440cb`
- Patched `src/variant_iter.rs` SHA-256: `a0f5ee8acb8faa089bcdfbc9a57372609fce7654026ccef7d9a224d05a654ccc`
- Advisory: https://rustsec.org/advisories/RUSTSEC-2024-0429.html

The root native manifest patches crates.io resolution to this local source for every transitive GLib consumer.
The dependency remains version 0.18.5 because GTK 0.18 cannot use GLib 0.20's incompatible API.
Do not relabel this source as an upstream fixed release or reintroduce the vulnerable registry package.
Linux CI exercises forward, backward, mixed, nth and last string iteration with optimization enabled.
macOS does not compile this Linux runtime dependency.
See [ADR 0012](../../docs/adr/0012-glib-security-backport.md) for the maintenance and removal criteria.
