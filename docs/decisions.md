# Decisions

## Ownership and module boundary

Builder A owns the app shell, wallet context, market/stock data, token configuration, and swap implementation. Builder B owns plain pocket functions, encryption and backup checks, USDT transfer functions, session guards, job persistence, and the tick runner under `packages/shared/src/pocket`. The `/pocket` panel is optional semantic HTML only; A owns mounting and restyling.

## Session key decision: app-held key

Use the app-held session key, not Wallet Skills. The browser generates the key, encrypts it with the pocket passphrase, and stores the ciphertext in localStorage. Unlocking derives the ethers session signer used by pocket operations and the guarded agent adapter. A2 must bind `SwapPipeline.execute` to this session signer; the main-wallet signer remains limited to user-initiated funding.

## Signers and approvals

Pocket functions receive A's connected `mainAddress` and `getMainSigner`; they do not connect a wallet. Main signer is accepted only by the user-initiated fund function. The agent unlocks the session signer and the guard verifies its address, but `SwapPipeline.execute(quote, receiver)` does not accept a signer. A2 must bind the real provider to the session signer, never main. Live approval is not implemented in the mock flow; A2 must use an exact session-token approval and never grant an unlimited allowance.

## Key and balance risks

The browser creates a random session key and encrypts it with AES-GCM and PBKDF2-SHA-256 at 600,000 iterations, using a random 16-byte salt and 12-byte IV. Ciphertext is in localStorage; XSS could exfiltrate it for offline passphrase guessing, so use a strong passphrase. Plaintext exists temporarily during export/signing and in the user-downloaded backup; JavaScript cannot reliably zeroize it. Funding requires a pasted key whose derived address matches the pocket. Keep balances small and retain BNB in the pocket for gas.

## Shared network configuration

Chain ID is 56, BSC RPC and USDT address are configured in `pocket/config.ts`, USDT uses 18 decimals, quote TTL is 30 seconds, and system buy cap is $25. AAPLx and the approval spender must be supplied through `NEXT_PUBLIC_AAPLX_ADDRESS` and `NEXT_PUBLIC_SWAP_SPENDER_ADDRESS`; neither is guessed. If either is absent, the adapter and agent remain unavailable.

## Agent accounting and clock

Job cap, spent amount, reserved amount, and last UTC run day persist per pocket in localStorage. Web Locks serialize same-origin tabs. Reservations occur before execution; known pre-execution failures release reserved amount while retaining the day marker. An ambiguous execute result retains the reservation to avoid duplicate spend. The current clock is a browser interval; background throttling can miss the scheduled minute and page close stops it. Move scheduling to `apps/worker` before live use.

## Known unavailable integrations

No live provider, AAPLx address, approval spender, or approval binding is configured, so live agent trading is unavailable. Railgun is not wired. Take-profit remains inactive until A supplies a price source. No main-wallet transfer path is reachable from the agent runner.