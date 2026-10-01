# Decisions

## Ownership and module boundary

Builder A owns the app shell, wallet context, market/stock data, token configuration, and swap implementation. Builder B owns plain pocket functions, encryption and backup checks, USDT transfer functions, session guards, job persistence, and the tick runner under `packages/shared/src/pocket`. The `/pocket` panel is optional semantic HTML only; A owns mounting and restyling.

## Signers and approvals

Pocket functions receive A's connected `mainAddress` and `getMainSigner`; they do not connect a wallet. Main signer is accepted only by the user-initiated fund function. A session signer is derived from the pocket key and supplied to the adapter. The only agent execution surface is `executeGuardedTrade` through the guarded adapter. A helper binding must provide an exact approval callback; the guard rejects an approval amount that differs from the trade amount and requires the quoted approval spender. Never grant an unlimited allowance. No live helper or approval binding is present, so the default adapter is unavailable.

## Key and balance risks

The browser creates a random session key and encrypts it with AES-GCM and PBKDF2-SHA-256 at 600,000 iterations, using a random 16-byte salt and 12-byte IV. Ciphertext is in localStorage; XSS could exfiltrate it for offline passphrase guessing, so use a strong passphrase. Plaintext exists temporarily during export/signing and in the user-downloaded backup; JavaScript cannot reliably zeroize it. Funding requires a pasted key whose derived address matches the pocket. Keep balances small and retain BNB in the pocket for gas.

## Shared network configuration

Chain ID is 56, BSC RPC and USDT address are configured in `pocket/config.ts`, USDT uses 18 decimals, quote TTL is 30 seconds, and system buy cap is $25. AAPLx and the approval spender must be supplied through `NEXT_PUBLIC_AAPLX_ADDRESS` and `NEXT_PUBLIC_SWAP_SPENDER_ADDRESS`; neither is guessed. If either is absent, the adapter and agent remain unavailable.

## Agent accounting and clock

Job cap, spent amount, reserved amount, and last UTC run day persist per pocket in localStorage. Web Locks serialize same-origin tabs. Reservations occur before execution; known pre-execution failures release reserved amount while retaining the day marker. An ambiguous execute result retains the reservation to avoid duplicate spend. The current clock is a browser interval; background throttling can miss the scheduled minute and page close stops it. Move scheduling to `apps/worker` before live use.

## Known unavailable integrations

No A swap helper/signatures/quote shape, wallet context, AAPLx address, price source, or market-hours source exists in this repository. Railgun is not wired. Take-profit remains inactive until A supplies a price source. No main-wallet transfer path is reachable from the agent runner.