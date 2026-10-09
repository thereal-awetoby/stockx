# stockX

Builder B owns headless session-pocket logic under `packages/shared/src/pocket`. The `/pocket` reference panel is wired to the connected wallet for user-initiated funding and withdrawal, and is linked from the app header. It still uses a mock swap pipeline; quote retrieval and market data do not yet provide live signing or transaction execution.

The pocket module includes browser-local encrypted key storage, user-initiated BSC USDT transfers, session-only guards, persistent job reservations, a browser-clock hook, and honest-copy constants. Live agent swaps, exact approvals, take-profit execution, and worker scheduling remain unimplemented.

The v1 agent uses the browser clock; there is no worker. Closing the page or browser background throttling can delay or stop scheduled checks.

The pocket's configured market is `stock: "AAPL"` with token `AAPLB`. Set the public token config in `apps/web/.env.local` for live execution:

```dotenv
NEXT_PUBLIC_AAPLB_ADDRESS=0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a
NEXT_PUBLIC_AAPLB_DECIMALS=18
```

Never commit `.env.local`; no swap-spender environment variable is used.

Read `docs/decisions.md`, `docs/devex-notes.md`, `docs/devex-b.md`, and `docs/builder-a-handoff.md` before integrating the panel or helper.