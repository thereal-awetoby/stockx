# Decisions

## First token: AAPLB (bStocks)

Switched from AAPLx on 2026-10-06. The Binance Web3 RWA Data API lists only the `bstock` and `ondo` platforms. For AAPLx, `rwa/price` returned no platform, a token price equal to its reference price, and a timestamp days old, so no premium can be computed. The AAPLx quote also required an RFQ request with a wallet address. For AAPLB, `rwa/price` returns a token price and a reference price (premium computable), and the quote came back with executionMode SWAP and 18 decimals. Contract on BSC: `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a` (from RWA search). This satisfies the hackathon rule (one of bStocks, Ondo, xStocks). Ondo and xStocks only if time allows.

## Market data and swap source: Binance Web3 API

Base URL `https://web3.binance.com/build`. Every request is signed with HMAC-SHA256 and sent with `X-OC-APIKEY`, `X-OC-TIMESTAMP` and `X-OC-SIGN`; the signed path must include `/build`. `OC_API_KEY` and `OC_SECRET_KEY` live in `apps/web/.env.local`, are server-only, and never get a `NEXT_PUBLIC_` prefix. The browser calls our own Next.js route handlers (`apps/web/app/api/...`), which sign and forward. Endpoints in use: `rwa/search`, `rwa/price` (parameter `tokenContractAddresses`), `rwa/underlying-market` (parameters `binanceChainId` and `tokenContractAddress`), `aggregator/quote`, `aggregator/swap`, `aggregator/approve-transaction`, `pre-transaction/simulate`, `pre-transaction/broadcast-transaction`. The API checks client IP and server location against a restricted-regions list, so the deployment region must be outside it.

## Approval spender (A's proposal, B to confirm)

The spender is read from the API quote's `approveTarget`, not from an environment variable. Approvals are for the exact amount, never unlimited.

## Ownership and module boundary

Builder A owns the app shell, wallet context, market/stock data, token configuration, and swap implementation. Builder B owns plain pocket functions, encryption and backup checks, USDT transfer functions, session guards, job persistence, and the tick runner under `packages/shared/src/pocket`. The `/pocket` panel is optional semantic HTML only; A owns mounting and restyling.

## Session key decision: app-held key

Use the app-held session key, not Wallet Skills. The browser generates the key, encrypts it with the pocket passphrase, and stores the ciphertext in localStorage. Unlocking derives the ethers session signer used by pocket operations and the guarded agent adapter. A2 must bind `SwapPipeline.execute` to this session signer; the main-wallet signer remains limited to user-initiated funding.

## Signers and approvals

Pocket functions receive A's connected `mainAddress` and `getMainSigner`; they do not connect a wallet. Main signer is accepted only by the user-initiated fund function. The agent unlocks the session signer and the guard verifies its address, but `SwapPipeline.execute(quote, receiver)` does not accept a signer. A2 binds the real provider to a signer when the provider is created: the DIY path uses the connected main wallet, the agent path uses the session signer, and the agent provider is never given main. Live approval is not implemented in the mock flow; A2 must use an exact session-token approval and never grant an unlimited allowance.

## Key and balance risks

The browser creates a random session key and encrypts it with AES-GCM and PBKDF2-SHA-256 at 600,000 iterations, using a random 16-byte salt and 12-byte IV. Ciphertext is in localStorage; XSS could exfiltrate it for offline passphrase guessing, so use a strong passphrase. Plaintext exists temporarily during export/signing and in the user-downloaded backup; JavaScript cannot reliably zeroize it. Funding requires a pasted key whose derived address matches the pocket. Keep balances small and retain BNB in the pocket for gas.

## Shared network configuration

Chain ID is 56, BSC RPC and USDT address are configured in `pocket/config.ts`, USDT uses 18 decimals, quote TTL is 30 seconds, and system buy cap is $25. The AAPLB address is supplied through `NEXT_PUBLIC_AAPLB_ADDRESS`; it is not guessed. If it is absent, live AAPLB execution remains unavailable.

## Agent accounting and clock

Job cap, spent amount, reserved amount, and last UTC run day persist per pocket in localStorage. Web Locks serialize same-origin tabs. Reservations occur before execution; known pre-execution failures release reserved amount while retaining the day marker. An ambiguous execute result retains the reservation to avoid duplicate spend. The current clock is a browser interval; background throttling can miss the scheduled minute and page close stops it. Move scheduling to `apps/worker` before live use.

## Known unavailable integrations

No live swap provider is wired yet (A2 in progress), so live agent trading is unavailable. Railgun is not wired. Take-profit remains inactive until A supplies a price source (A will expose the Binance RWA price). No main-wallet transfer path is reachable from the agent runner.

## A2: swap execution (2026-10-09)

One provider, bound to one signer. The tx is built server-side from a fresh quote on every build, validated twice (server and browser), and re-built right before sending. Approval is exact-amount, encoded locally rather than taken from the API's approve endpoint, so a wrong API response cannot widen it. Slippage default 50 bps; the confirmed output minus slippage is the floor for the re-quote. Live sending is behind `NEXT_PUBLIC_LIVE_SWAPS=1` until the dry run in `docs/builder-a-handoff.md` is done. The `/swap` response shape is unverified; the parser fails closed.

## Token registry and the live list (2026-10-10)

`scripts/discover-rwa.mjs` crawls Binance RWA search and dry-quotes 1 USDT of every bStock/Ondo token on BSC into `docs/rwa-registry.json` (sends nothing). `node scripts/build-token-registry.mjs` turns that into `packages/shared/src/token-registry.data.ts` (generated, committed): the 62 bStocks that quote as a normal `SWAP` with 18 decimals, no honeypot or tax flag, the same approve target as AAPLB, and at most 0.5% price impact. Dropped on purpose: all Ondo tokens (they quote only from $5 and the app has no RFQ flow), leveraged/inverse products (MUUB, SQQQB, KORUB, TQQQB, INTWB; README says no leverage), and QNTB (1% impact).

**Listed is not tradable.** `VERIFIED_LIVE_SYMBOLS` in `token-registry.ts` is the only list of tradable tokens, and it starts as `["AAPLB"]`. Everything else shows as "Coming soon". The gate is enforced in `resolvePair` (so the provider and both swap routes refuse a non-live token) and in the agent's `isSupportedStockRoute`, not just hidden in the UI. Addresses always come from the registry, never from the client.

To make a token live: set `NEXT_PUBLIC_EXTRA_LIVE=NVDAB` in `apps/web/.env.local` (comma separated; unknown symbols are ignored), restart `npm run dev`, buy about $1 through the app, check the transaction on BscScan, sell it back, then add the symbol to `VERIFIED_LIVE_SYMBOLS` and commit. The agent stays AAPLB-only (`agent-runner.ts`, `instruction.ts`); its guard would allow any live token but nothing asks for one yet.

Caveats seen in the registry: 45 of the 62 route through the `Rfq Neptunex` venue (the API still reports mode `SWAP`), so a quote can be stale sooner than for AAPLB; the re-quote-before-send step and the 30 s freshness rule already cover that. Sells are capped at 1 token per swap regardless of token price.
