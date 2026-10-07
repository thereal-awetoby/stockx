# stockX

Builder B owns headless session-pocket logic under `packages/shared/src/pocket`. The `/pocket` reference panel is wired to the connected wallet for user-initiated funding and withdrawal, and is linked from the app header. It still uses a mock swap pipeline; quote retrieval and market data do not yet provide live signing or transaction execution.

The pocket module includes browser-local encrypted key storage, user-initiated BSC USDT transfers, session-only guards, persistent job reservations, a browser-clock hook, and honest-copy constants. Live agent swaps, exact approvals, take-profit execution, and worker scheduling remain unimplemented.

Read `docs/decisions.md`, `docs/devex-notes.md`, and `docs/builder-a-handoff.md` before integrating the panel or helper.