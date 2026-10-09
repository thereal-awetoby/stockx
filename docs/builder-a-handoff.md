# Builder A Handoff

| Integration item | Status | Needed from A |
|---|---|---|
| Helper method signatures | READY | Pocket and agent use the shared `SwapPipeline`: decimal-string amount, typed simulation, and `{ txHash, receiver }` execution result. |
| Quote object shape | READY | Pocket validates the shared quote request and requires `spender` and `receiver` to be `session`; helper owns expiry and simulate-before-execute checks. |
| Session signer binding | DONE FOR DIY, OPEN FOR AGENT | `createBinanceProvider({ executor, wallet })` binds a provider to one `WalletExecutor` (one signer). DIY uses `createViemExecutor` with the connected main wallet (`apps/web/lib/viem-executor.ts`). B must write the session executor (ethers `Wallet` + JsonRpcProvider implementing `WalletExecutor`) and build the agent provider with `wallet: "session"`; a provider refuses requests for the other wallet (`WALLET_MISMATCH`). |
| Approval handling | DONE | The provider encodes `approve(approveTarget, amountIn)` itself (exact, never unlimited), checks the calldata it is about to send, waits for the receipt, re-reads the allowance, then re-quotes before the swap. Covered by `binance-provider.test.ts`. |
| AAPLB address and decimals | BLOCKED FOR LIVE EXECUTION | Pocket config fails closed unless `NEXT_PUBLIC_AAPLB_ADDRESS` and `NEXT_PUBLIC_AAPLB_DECIMALS` are set. They are absent from this checkout's `apps/web/.env.local`; use the verified BSC token address and 18 decimals in the local/deployment environment. This warning does not block USDT pocket funding or withdrawal. |
| Approval spender | DONE | Spender is the quote's `approveTarget`. B to confirm. |
| Price and market data | READY FOR DISPLAY | Binance RWA price and underlying-market routes are wired into the stock page. Agent take-profit logic and its execution policy are still inactive/open. |
| Web wallet dependencies | READY | `wagmi@^2`, `viem`, and `@tanstack/react-query` are declared in `apps/web/package.json`; root lockfile was updated. |
| BSC chain export | FIXED IN APP | `wagmi/chains` could not resolve `bsc` from the incomplete local viem install. `apps/web/lib/wagmi.ts` now defines the BSC mainnet chain locally and `ConnectButton` imports that shared config value. |
| Wallet context (`mainAddress`, `getMainSigner`) | READY IN APP | `/pocket` uses `useAccount` / `useWalletClient`, creates an ethers `BrowserProvider` signer, and passes the connected address and signer getter to `PocketPanel`. Main signer remains for user-initiated transfers only. |
| Holdings session slot and `SessionTradeRecord` | OPEN | A adds a session slot and consumes the exported type `{ jobId, side, token, amountUsdt, txHash, timestamp, source: "agent-session" }`. |
| Navigation entry | READY IN APP | Header links to `/pocket`. |
| Restyling the reference panel | A-owned | A owns all CSS/design and may replace `PocketPanel` while keeping `usePocket` contracts. |
| Worker scheduling | OPEN | Browser clock is temporary; A/B must agree on worker deployment/runtime before live automation. |

Pocket pipeline proposal:

- B's pocket and agent consume `SwapPipeline` directly. The legacy pocket `SwapHelper` type and adapter are removed; no adapter is needed.
- The package-root `packages/shared/src/index.ts` exports are unchanged. Pocket exports remain scoped to `@stockx/shared/pocket`.
- The pocket panel still defaults to the mock pipeline. The stock buy panel retrieves quotes, but signing/broadcasting is not implemented; do not present this as live trading.
- `readPocketBalances(address)` remains `{ usdt, bnb }`. The UI reads AAPLB separately with ERC-20 `balanceOf`; no shared balance type was changed.
- `/pocket` uses `useAccount` / `useWalletClient` and an ethers `BrowserProvider` signer for user-initiated transfers. It displays the connected main-wallet address.
- The agent checks `getRwaMarket(AAPLB).open` before reserving spend or requesting a quote, and skips while the market is closed. Take-profit remains inactive and the agent remains buy-only.
- B's guarded flow validates the session signer but does not supply it to `SwapPipeline`; choose a signer-bound provider/factory approach before A2 goes live.
- Agent guardrails include a $5 maximum trade, $25 job/funding caps, one trade per UTC day, a disarmed-by-default kill switch, and a run log that includes `SwapError.code`.

Validation on 2026-10-09: clean root reinstall completed; workspace typechecks passed; all 21 pocket tests and 10 core tests passed; `/pocket` returned HTTP 200. New tests cover closed-market skipping, empty pocket, spend cap, and stopped job. A prior user fund attempt failed at `estimateGas` with `BEP20: transfer amount exceeds balance`; it failed before broadcast, so there is no transaction hash or gas cost. No successful mainnet fund/withdraw test has been recorded.

The clean checkout has no captured output from `scripts/binance-swap-test.mjs`. Do not implement A2 against an assumed swap response. Before the next push, check for `stock-a2.patch` and apply it with `git am stock-a2.patch` if available; that patch was not present in the repository as of 2026-10-09. Do not start a real-funds test or send a mainnet transaction without the user's explicit approval.

## A2 update (2026-10-09): real swap provider

New: `packages/shared/src/swap-build.ts` (units, approve encoding, response parsing, `assertSafeSwapTx`), `binance-provider.ts` (`createBinanceProvider`), `apps/web/app/api/swap/build/route.ts`, `apps/web/lib/viem-executor.ts`, and a rewritten `BuyPanel` (quote, simulate, review, confirm).

Flow: `/api/swap/build` asks the aggregator for a fresh quote, builds the swap from that quote id and validates it (no native value, not a token contract, not an approve/transfer, not the wallet). The browser re-validates, simulates (balance, chain, allowance, dry run), and on confirm sends an exact approval if needed, waits, **re-builds from a fresh quote**, refuses with `PRICE_MOVED` if the output fell below the confirmed amount minus slippage (default 0.5%, route max 1%), dry-runs, sends. Any quote older than 30s is refused. A double click cannot send twice. If a receipt is lost after broadcast you get `RECEIPT_UNKNOWN` with the hash; never auto-retry.

### `/swap` response: verified 2026-10-09

Captured from the live API with `scripts/binance-swap-test.mjs` (wallet address replaced in `packages/shared/src/fixtures/binance-swap-real.json`). Shape: `data = { executionMode, routerResult, tx, rfq }` and `tx = { from, to, data, value, gas, gasPrice, minReceiveAmount, slippagePercent, signatureData }`. `tx.to` equals the quote's `approveTarget` (the router). Our integer slippage floor reproduces Binance's `minReceiveAmount` exactly, and the build now also checks `tx.from`, uses `routerResult.toTokenAmount`, and refuses a swap whose own minimum is looser than the confirmed one. The 40001 error seen earlier came from a copy of the script that sent no slippage; the repo version sends `slippagePercent`.

Before enabling live swaps:

1. `npm install && npm test && npm run typecheck && npm run build` (the A2 code was written where npm was blocked: provider tests and a strict `tsc` over the shared files ran, the web files were only syntax-checked).
2. Set `NEXT_PUBLIC_LIVE_SWAPS=1` locally, buy $1 of AAPLB from a throwaway wallet, check BscScan.

### Still open

- Sell UI (provider and route already support `side=sell`, capped at 1 AAPLB).
- Session executor + agent wiring (B); worker scheduling; take-profit price source.
- Holdings and history (A3).
