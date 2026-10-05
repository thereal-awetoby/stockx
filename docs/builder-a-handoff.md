# Builder A Handoff

| Integration item | Status | Needed from A |
|---|---|---|
| Helper method signatures | READY | Pocket and agent use the shared `SwapPipeline`: decimal-string amount, typed simulation, and `{ txHash, receiver }` execution result. |
| Quote object shape | READY | Pocket validates the shared quote request and requires `spender` and `receiver` to be `session`; helper owns expiry and simulate-before-execute checks. |
| Session signer binding | OPEN FOR A2 | The runner unlocks and validates the app-held session signer, but `SwapPipeline.execute(quote, receiver)` has no signer parameter. A2 must agree how the real provider is bound to that signer; never sign with main. |
| Approval handling | OPEN FOR A2 | The mock requires no approval. The legacy approval adapter was removed during pipeline migration. A2 must provide exact session-token approval and never grant unlimited allowance. |
| AAPLx address | BLOCKED | Supply and validate `NEXT_PUBLIC_AAPLX_ADDRESS`; no address is stored or guessed here. |
| Approval spender address | BLOCKED | Supply `NEXT_PUBLIC_SWAP_SPENDER_ADDRESS` from the actual helper/router configuration. |
| Price source and market-hours source | BLOCKED / OPEN | No price source exists, so take-profit is inactive. Market-hours behavior remains OPEN until A provides its source and rules. |
| Web wallet dependencies | READY | `wagmi@^2`, `viem`, and `@tanstack/react-query` are declared in `apps/web/package.json`; root lockfile was updated. |
| BSC chain export | FIXED IN APP | `wagmi/chains` could not resolve `bsc` from the incomplete local viem install. `apps/web/lib/wagmi.ts` now defines the BSC mainnet chain locally and `ConnectButton` imports that shared config value. |
| Wallet context (`mainAddress`, `getMainSigner`) | BLOCKED | `/pocket` still has the `TODO A` placeholder. Wire `useAccount` / `useWalletClient`, construct the ethers `BrowserProvider` signer, and pass the connected address and signer getter. |
| Holdings session slot and `SessionTradeRecord` | OPEN | A adds a session slot and consumes the exported type `{ jobId, side, token, amountUsdt, txHash, timestamp, source: "agent-session" }`. |
| Navigation entry | OPEN | A adds `/pocket` to the app navigation. |
| Restyling the reference panel | A-owned | A owns all CSS/design and may replace `PocketPanel` while keeping `usePocket` contracts. |
| Worker scheduling | OPEN | Browser clock is temporary; A/B must agree on worker deployment/runtime before live automation. |

Pocket pipeline proposal:

- B's pocket and agent consume `SwapPipeline` directly. The legacy pocket `SwapHelper` type and adapter are removed; no adapter is needed.
- The package-root `packages/shared/src/index.ts` exports are unchanged. Pocket exports remain scoped to `@stockx/shared/pocket`.
- The mock pipeline is agent-restricted and is the default for the pocket panel until A2 supplies the real provider.
- `readPocketBalances(address)` returns only `{ usdt, bnb }`. Before A3, agree whether A reads AAPLx balance separately or B later adds a `tokens[]` field.
- B's guarded flow validates the session signer but does not supply it to `SwapPipeline`; choose a signer-bound provider/factory approach before A2 goes live.
- Agent guardrails include a $5 maximum trade, $25 job/funding caps, one trade per UTC day, a disarmed-by-default kill switch, and a run log that includes `SwapError.code`.

Validation at handoff: 17 pocket tests and 10 core tests passed; shared and web typechecks passed before the latest interrupted clean install. The local BSC definition fixes the prior `wagmi/chains` export error. A production build is still unverified because the interrupted `npm ci` left `node_modules` incomplete (`node_modules/.bin` and viem `.d.ts` files are absent); complete a clean install, then rerun root typecheck, tests, and build before pushing. Do not enable live execution until A2 provides the real session-signer-bound provider and exact approval path.

The route wiring sketch for A (after wallet dependencies are approved):

```tsx
"use client";

import { BrowserProvider } from "ethers";
import { createMockProvider, createSwapHelper } from "@stockx/shared";
import { useAccount, useWalletClient } from "wagmi";
import { PocketPanel } from "../../features/pocket/PocketPanel";

const pipeline = createSwapHelper(createMockProvider(), { actor: "agent" });

export default function PocketPage() {
  const { address = "" } = useAccount();
  const { data: walletClient } = useWalletClient();
  const getMainSigner = async () => {
    if (!walletClient) throw new Error("Connect the main wallet first.");
    const provider = new BrowserProvider(walletClient.transport, {
      chainId: walletClient.chain.id,
      name: walletClient.chain.name,
    });
    return provider.getSigner(walletClient.account.address);
  };

  return <PocketPanel mainAddress={address} getMainSigner={getMainSigner} pipeline={pipeline} />;
}
```