# stockX

Builder B owns headless session-pocket logic under `packages/shared/src/pocket`. The Next app root is an A-owned placeholder. An optional, unstyled reference panel is available at `/pocket`; it has no wallet connection implementation and requires A's wallet context and swap adapter before actions can be used.

The pocket module includes browser-local encrypted key storage, user-initiated BSC USDT transfers, session-only guards, persistent job reservations, a browser-clock hook, and honest-copy constants. It does not include a live stock swap helper, AAPLx address, price feed, market-hours source, or worker.

Read `docs/decisions.md`, `docs/devex-notes.md`, and `docs/builder-a-handoff.md` before integrating the panel or helper.