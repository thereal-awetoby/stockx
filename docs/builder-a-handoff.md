# Builder A Handoff

| Integration item | Status | Needed from A |
|---|---|---|
| Helper method signatures | BLOCKED | Provide the actual quote/simulate/execute TypeScript types. B's provisional interface is `quote(input)`, `simulate(quote)`, `execute(quote, receiver)`; no implementation exists here. |
| Quote object shape | BLOCKED | Provide embedded spender, receiver, token pair, amount, timestamp, and approval-spender field names/types so B can adapt validation exactly. |
| Session signer parameter | BLOCKED | Provide a binder that accepts B's `SessionSigner`; the guarded executor must remain the only route to execute. |
| Approval handling | BLOCKED | Provide the approval contract API and spender source. B rejects non-exact approval amounts and validates the quoted spender; live approval is not implemented. |
| AAPLx address | BLOCKED | Supply and validate `NEXT_PUBLIC_AAPLX_ADDRESS`; no address is stored or guessed here. |
| Approval spender address | BLOCKED | Supply `NEXT_PUBLIC_SWAP_SPENDER_ADDRESS` from the actual helper/router configuration. |
| Price source and market-hours source | BLOCKED / OPEN | No price source exists, so take-profit is inactive. Market-hours behavior remains OPEN until A provides its source and rules. |
| Wallet context (`mainAddress`, `getMainSigner`) | BLOCKED | Mount `PocketPanel` from A's wallet context and pass the connected address and signer getter. `/pocket` is currently a TODO placeholder. |
| Holdings session slot and `SessionTradeRecord` | OPEN | A adds a session slot and consumes the exported type `{ jobId, side, token, amountUsdt, txHash, timestamp, source: "agent-session" }`. |
| Navigation entry | OPEN | A adds `/pocket` to the app navigation. |
| Restyling the reference panel | A-owned | A owns all CSS/design and may replace `PocketPanel` while keeping `usePocket` contracts. |
| Worker scheduling | OPEN | Browser clock is temporary; A/B must agree on worker deployment/runtime before live automation. |

Five-line integration sketch for A:

```tsx
const pocket = usePocket({ mainAddress, getMainSigner, executor });
const sessionTrades: SessionTradeRecord[] = pocket.activity;
return <section><h2>Session pocket</h2><p>{pocket.balances.usdt} USDT</p>
  <button disabled={!pocket.exported || !executor} onClick={() => pocket.startAgent()}>Start</button>
  <PocketPanel mainAddress={mainAddress} getMainSigner={getMainSigner} executor={executor} /></section>;
```