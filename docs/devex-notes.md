# DevEx Notes

## B-owned module

- Pocket logic is headless under `packages/shared/src/pocket`; callers inject storage/locks and A supplies the connected main address/signer.
- Browser Web Locks serialize pocket creation and job reservations across tabs. Browsers without Web Locks fail closed.
- Web Crypto encrypts the session key locally. Backup verification derives and compares its address before funding is enabled.
- Transfers use BSC USDT. The pocket needs BNB for withdrawal gas and agent execution; the panel shows the balance and a low-gas warning.
- The job store persists cap, reserved/spent totals, and the UTC run day. Known failures before helper execution release the reservation; uncertain execution outcomes retain it.

## Builder A dependencies

- No quote/simulation/execute implementation or quote object definition was present, so real RFQ freshness and error behavior are unverified.
- No AAPLx address, main-wallet context, signer provider, approval implementation, gas estimator, price source, or market-hours source was present.
- The adapter defaults to unavailable. A must supply a signer-bound helper, exact approval callback, gas estimator, AAPLx address, and approval-spender address before agent controls can run.
- Approval policy is exact amount to the quote's configured spender only. Live approval behavior is unverified until A supplies the contract adapter.
- Railgun is not integrated; the panel only exports copy data with `railgunEnabled = false`.

## Scheduler

The v1 agent uses a browser clock and has no worker. Browser background throttling can miss the scheduled minute; closing or reloading stops it.

No video recording is included. The panel is a semantic reference and not a finished app surface.