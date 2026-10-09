# Builder B DevEx report

## 2026-10-09

- Checkout was clean on `master` at `4d1879f`, matching `origin/master`; `git pull` reported already up to date.
- The expected numbered handoffs and `README-BUILDER-B.md` were absent. Read the available README, Builder A handoff, and decisions document instead. A's stock, quote, RWA API, wallet-context, and header changes are present in recent commits.
- No captured output from `scripts/binance-swap-test.mjs` was found. Section A2 remains gated; do not implement a real provider until the swap response is captured and reviewed.
- The first clean-install attempt removed `node_modules` but PowerShell blocked the `npm` script shim before npm ran. A retry with `npm.cmd install` remained silent for over 20 minutes and was stopped. A verbose retry succeeded in about 6 minutes (`51 packages changed`), but its interrupted-install tree lacked `viem` declarations. A subsequent full clean verbose install succeeded (`833 packages` in 33 minutes); `package-lock.json` remained unchanged.
- After the full clean install, workspace typecheck passed. Shared tests passed: 21 pocket tests in 16.9 seconds and 10 core tests in 7.85 seconds.
- `npm.cmd run dev` reported ready in 14.9 seconds. A final request to `/pocket` returned HTTP 200, and the rendered HTML contained both the main-wallet label and AAPLB balance label.
- No API keys or other secrets were read, copied, or logged.
- Binance Web3 region restrictions include the UK. This environment's egress and deployment region were not verified; if either is UK-based, expect possible API blocking and confirm an allowed region before relying on the live routes.
- The v1 agent remains buy-only and take-profit remains inactive, per user direction. The stock UI's real price API exists, but there is no defined take-profit position/threshold policy to apply to agent execution.

## Scheduling and transaction safety

- The v1 agent uses the browser clock; there is no worker. Closing the page or background throttling can stop or delay checks.
- No real funds were moved and no mainnet transactions were sent. Funding/withdrawal remains pending explicit user approval.
- No gas or transaction timing has been recorded yet.

## Errors and confusing points

- On this machine, `npm` resolves to `npm.ps1`, which is blocked by the current PowerShell execution policy. Use the Windows `npm.cmd` shim rather than changing the policy.
- Registry revalidation during the clean install was slow (individual package metadata fetches took roughly 30 seconds); verbose npm output showed registry responses succeeding and all `esbuild`/native postinstall scripts exiting successfully.
- `Invoke-WebRequest` initially failed while Next.js was compiling `/pocket`, then timed out on the first request. A subsequent `curl.exe` request returned HTTP 200 after compilation; checking again with curl avoided treating the warm-up delay as a server failure.
- The repository has one available Builder A handoff rather than the requested Handoff 3/2 and older Builder B README. The available handoff is treated as checkout context, not as a substitute for any missing newer instructions.
