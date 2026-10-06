// Run from the repo root:  node scripts/check-tokens.mjs
// Reads name / symbol / decimals straight from BSC so we never trust a screenshot.
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";

const RPC = process.env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed.binance.org";
const client = createPublicClient({ chain: bsc, transport: http(RPC) });
const abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const tokens = {
  AAPLx: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
  AAPLB: "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a",
  AAPLon: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
  USDT: "0x55d398326f99059ff775485246999027b3197955",
};

for (const [label, address] of Object.entries(tokens)) {
  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address, abi, functionName: "name" }),
      client.readContract({ address, abi, functionName: "symbol" }),
      client.readContract({ address, abi, functionName: "decimals" }),
    ]);
    console.log(`${label}: name="${name}" symbol="${symbol}" decimals=${decimals}`);
  } catch (e) {
    console.log(`${label}: FAILED -> ${e.shortMessage || e.message}`);
  }
}