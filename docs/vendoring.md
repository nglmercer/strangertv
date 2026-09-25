# Vendoring

How the pinned copy of `better-auth-rs` in `rust/vendor/` is managed, and how
Rust dependency security is covered.

## What is vendored, and why

`rust/Cargo.toml` depends on the auth library by path:

```toml
better-auth = {
    path = "vendor/better-auth-rs/crates/better-auth",
    default-features = false,
    features = ["axum", "libsql"],
}
```

The sources under `rust/vendor/better-auth-rs/` are a verbatim copy of
upstream `nglmercer/better-auth-rs` at the pinned commit recorded in
[Auth migration plan](./migration-plan.md) (currently
`aa0117e49d30ff69d1ed36c74df27193c062f2de`). They are checked in directly —
not a git submodule — because builders that shallow-clone without
`--recurse-submodules` (Railway and friends) got an empty vendor directory
and the Docker build failed to read `crates/better-auth/Cargo.toml`.

Do **not** track upstream `main` during the migration. Pin the vendored copy
and update it deliberately (below).

## Updating the vendored copy

1. Pick the new upstream commit and record it in
   [migration-plan.md](./migration-plan.md) ("Target Better Auth revision").
2. Re-sync the tree. From a clone of `nglmercer/better-auth-rs` at that
   commit, copy `crates/` and the workspace `Cargo.toml` (plus its
   `Cargo.lock` and `README.md` when present) over `rust/vendor/better-auth-rs/`:

   ```bash
   UPSTREAM=/path/to/better-auth-rs  # checked out at the new commit
   rm -rf rust/vendor/better-auth-rs/crates
   cp -r "$UPSTREAM/crates" rust/vendor/better-auth-rs/crates
   cp "$UPSTREAM/Cargo.toml" rust/vendor/better-auth-rs/Cargo.toml
   cp "$UPSTREAM/Cargo.lock" rust/vendor/better-auth-rs/Cargo.lock 2>/dev/null || true
   ```

   Do not hand-edit the vendored sources: the tree must stay a verbatim copy
   of the recorded upstream commit so updates are diffable.
3. Refresh the main lockfile and verify the whole surface:

   ```bash
   cd rust && cargo update -p better-auth && cargo test
   cd .. && npm run check:generated && npm test
   ```

4. Commit the vendor tree, `rust/Cargo.lock`, and any regenerated
   `shared/generated/` output together with the migration-plan pin update.

## Rust dependency security

- **Dependabot** watches the `cargo` ecosystem in `/rust`
  (`.github/dependabot.yml`) and proposes weekly updates for the registry
  dependencies in `rust/Cargo.lock`. The vendored `better-auth-rs` tree is
  part of this repository, so Dependabot does not cover it — update it via
  the process above.
- **CI** runs `rustsec/audit-check` against `rust/Cargo.toml` on every push
  to `main`/`master` and every pull request (the `rust-audit` job in
  `.github/workflows/ci.yml`), failing the build on known RustSec
  advisories. To check locally:

  ```bash
  cargo install cargo-audit && cd rust && cargo audit
  ```
