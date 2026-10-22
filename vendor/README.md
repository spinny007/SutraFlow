# Maintained vendor dependencies

SutraFlow keeps two small, reviewed package forks here because the current upstream packages retain dependencies that the release security gate does not accept. They are not copied blindly during a build.

`vendor-lock.json` records the reviewed upstream version and npm integrity, the local patched version, the normalized source-tree SHA-256, why each patch exists, its consumers, its focused regression tests, and whether it belongs in a runtime archive.

## Gates

- `npm run vendor:check` works offline and runs before every production build. It checks the committed tree hash, package and package-lock links, scope, licence, consumers, tests, and runtime packaging policy.
- `npm run vendor:check:online` also asks the official npm registry for the current `latest` release and its integrity. Pull requests, pushes, release builds, and the weekly Vendor freshness workflow run it.
- `tools/build-release.mjs` reads `vendor-lock.json`; only entries marked as shipped runtime dependencies enter release archives.
- `npm audit`, focused ACME/FTP tests, and the complete suite remain separate required gates. A matching version number cannot prove API or behavioral compatibility.

## Updating a vendor package

1. Let the online gate report the newer upstream version. Do not replace the directory automatically.
2. Download that exact npm tarball and verify its `dist.integrity` from the registry.
3. Diff it against the reviewed upstream version and the SutraFlow fork. Review exported APIs and every consumer listed in `vendor-lock.json`.
4. Replace the upstream files, reapply only the documented security/compatibility patches, and increment the `-sutra.N` local version.
5. Update the upstream version and integrity in `vendor-lock.json` and run `npm install` to refresh `package-lock.json`.
6. Run `npm run vendor:lock` after reviewing the diff. This accepts the new local tree hash; it does not change the upstream version for you.
7. Run `npm run vendor:check:online`, `npm audit`, every focused test listed in the lock, and the complete PostgreSQL/MySQL regression suite. ACME changes also require the certificate issuance/renewal tests; FTP changes require the FTP server, connector, streaming, and trigger tests.
8. Build the release archives and verify that runtime vendor entries are present and test-only entries are absent.

If an upstream change is large or removes an API SutraFlow uses, update SutraFlow and its tests in the same pull request. Keeping an old reviewed fork is safer than silently copying incompatible “latest” code, but a failed freshness gate prevents a release until that decision is explicitly reviewed and recorded.
