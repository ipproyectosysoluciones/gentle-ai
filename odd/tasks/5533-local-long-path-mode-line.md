# #5533 — local `\\?\` paths flagged remote; misleading mode line after a failed clone mutation

Objective: only real network paths are classified as remote, and `review mode enable|disable` project a failed resolution the same way `review mode status` does.
Branch: `fix/5533-local-long-path-mode-line` (worktree `/home/gentleman/work/gentle-ai-5533`, base `origin/main` 7550c26f). Delivery: single PR closing #5533. Runner: `go test ./internal/reviewtransaction/... ./internal/cli/...`, `GOOS=windows go vet ./internal/reviewtransaction/... ./internal/cli/...`, `go run ./internal/gofmtcheck`, `go test ./...`.

## Specs

- **S1** Issue #5533 item 1 (verbatim): "`isUNCPath` (`internal/reviewtransaction/rar_path_safety_windows.go`) also matches local long-path forms such as `\\?\C:\repo\.git`. Since #5532 those refusals carry `Remote=true`, so the message talks about an SMB/UNC share for a local disk. Only `\\server\share` and `\\?\UNC\server\share` should count as remote." Expected: "Local `\\?\X:\` paths are not classified as remote." Keep #1918 fail-closed semantics: whatever refusal a local long path got before still happens, only the `Remote` flag/message changes. Do not change whether `\\?\X:\` paths are accepted unless the current code already accepts them via another branch.
- **S2** Issue #5533 item 2 (verbatim): "When `gentle-ai review mode disable --scope clone` fails on an unvalidatable Git common directory, it still prints `receipt-driven development: off (decided by clone_local)` next to `clone-local: unset` — the same misleading fail-closed projection that `review mode status` now replaces with `unavailable`. The mutation commands should project the failure the same way." Expected: "`review mode enable|disable` print `unavailable` (or no resolved line) when resolution fails, matching `review mode status`." JSON output unchanged; successful mutations byte-identical.
- **S3** Tests (RED first): Windows-tagged test for `\\?\C:\repo\.git` → not remote, `\\server\share\repo\.git` and `\\?\UNC\server\share\repo\.git` → remote (must compile under GOOS=windows); CLI test for a failed `disable --scope clone` (unvalidatable common dir via `.git/gentle-ai` symlink as in #5532 tests) → `unavailable`, not `decided by clone_local`; preservation: successful enable/disable output unchanged.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1-S3 | delegated (Writer trigger: parallel units with gentle-shell #2285) | done | this commit (see L2) |

Risk: item 2 (review authority guard) → independent verifier after T1.

## Log

- **L1** (2026-10-15, user, verbatim): "dale approve y merge si puedes" — approving issue #5533 (filed from the #5532 verifier advisories) and implementing it.
- **L2** (2026-10-15, writer, T1): S1 — the remote decision moved out of `isUNCPath` into the pure `windowsNetworkPath` (`rar_unsupported_filesystem.go`): only `\\server\share`, `\\?\UNC\` and `\\.\UNC\` (case-insensitive) are remote. `isUNCPath` still gates the refusal, so `\\?\C:\` / `\\.\C:\` are refused exactly as before (same typed `UnsupportedAuthorityFilesystemError`, unsafe-path and unknown-filesystem sentinels) with `Remote=false` and a namespace-prefix reason. S2 — `RunReviewMode` projects every failed operation as `unavailable`, except `RDDDisabledError` (clone enable under global off), the one refusal returned beside a resolved status and its note. JSON unchanged.
  - RED (S2): `go test ./internal/cli/ -run TestReviewModeFailedMutationReportsTheModeAsUnavailable` → `failed enable output = "receipt-driven development: off (decided by )\n  global:      unset\n  clone-local: unset\n", want only the unavailable line` (same for disable).
  - RED (S1): after a behavior-preserving move (`windowsNetworkPath` = `HasPrefix(path, "\\\\")`), `go test ./internal/reviewtransaction/ -run TestWindowsNetworkPathOnlyClassifiesServerSharesAsRemote` → `windowsNetworkPath("\\\\?\\C:\\repo\\.git") = true, want false` (also `\\?\c:`, `\\.\C:`, `\\?\Volume{…}`).
  - GREEN: both focused tests pass; Windows-tagged `TestRARWindowsLocalLongPathCommonDirIsRefusedButNotRemote` and the extended UNC test compile (`GOOS=windows go vet`, `GOOS=windows go test -c`) but cannot execute on this Linux host.
  - Differential vs base 7550c26f (text and `--json`, status/enable/disable, global and clone scope, `revision` masked): byte-identical except the two failed `enable|disable --scope clone` text lines, now `receipt-driven development: unavailable (the review mode could not be resolved)`.
  - Verification: `go build ./...` ok; `GOOS=windows go vet` ok; `go run ./internal/gofmtcheck` ok; `go test ./internal/reviewtransaction/... ./internal/cli/...` and `go test ./...` fail only the four known environmental tests (TestSnapshotIndexTemporaryPlacementAndCleanup, TestSnapshotInspectionPreservesGitDirectoryMetadataWithUsableProcessTemp, shellinstaller TestUserFrozenLockAcquisition, TestUserManagerCapabilityHelperUsesExecutableCustody).
