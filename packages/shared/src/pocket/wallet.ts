import { Contract, formatUnits, JsonRpcProvider, Wallet, parseUnits, type Signer } from "ethers";
import { POCKET_CONFIG } from "./config";
import type { PocketBalances, SessionSigner } from "./types";
import { TOKENS } from "../tokens";

export const POCKET_STORAGE_KEY = "stockx.session-pocket.v1";
export const MAX_POCKET_FUND_USDT = POCKET_CONFIG.systemJobCapUsdt;
const EXPORTED_STORAGE_KEY = "stockx.session-pocket.exported.v1";
const CREATE_LOCK = "stockx.session-pocket-create.v1";
const TOKEN_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];
const encoder = new TextEncoder();
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export interface StoredPocket {
  address: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface PocketStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parsePocket(value: string): StoredPocket {
  const parsed: unknown = JSON.parse(value);
  if (parsed == null || typeof parsed !== "object") throw new Error("Invalid stored pocket.");
  const pocket = parsed as Partial<StoredPocket>;
  if (
    typeof pocket.address !== "string" || !addressPattern.test(pocket.address) ||
    typeof pocket.salt !== "string" || typeof pocket.iv !== "string" || typeof pocket.ciphertext !== "string"
  ) {
    throw new Error("Invalid stored pocket.");
  }
  if (decodeBase64(pocket.salt).length !== 16 || decodeBase64(pocket.iv).length !== 12 || decodeBase64(pocket.ciphertext).length === 0) {
    throw new Error("Invalid stored pocket encryption data.");
  }
  return pocket as StoredPocket;
}

async function deriveEncryptionKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: 600_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function decryptPrivateKey(pocket: StoredPocket, password: string): Promise<string> {
  const key = await deriveEncryptionKey(password, decodeBase64(pocket.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(decodeBase64(pocket.iv)) },
    key,
    toArrayBuffer(decodeBase64(pocket.ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export function readPocket(storage: PocketStorage): StoredPocket | null {
  const stored = storage.getItem(POCKET_STORAGE_KEY);
  return stored === null ? null : parsePocket(stored);
}

export function pocketRecordExists(storage: PocketStorage): boolean {
  return storage.getItem(POCKET_STORAGE_KEY) !== null;
}

export function pocketBackupVerified(storage: PocketStorage, address: string): boolean {
  return storage.getItem(EXPORTED_STORAGE_KEY) === address.toLowerCase();
}

export async function createPocket(
  password: string,
  storage: PocketStorage,
  locks: LockManager,
): Promise<StoredPocket> {
  if (password.length < 10) throw new Error("Use a passphrase with at least 10 characters.");
  return locks.request(CREATE_LOCK, { mode: "exclusive" }, async () => {
    if (storage.getItem(POCKET_STORAGE_KEY) !== null) {
      throw new Error("A pocket record already exists. Creation was blocked to protect its key.");
    }
    const wallet = Wallet.createRandom();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveEncryptionKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      encoder.encode(wallet.privateKey),
    );
    const pocket: StoredPocket = {
      address: wallet.address,
      salt: encodeBase64(salt),
      iv: encodeBase64(iv),
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    };
    storage.setItem(POCKET_STORAGE_KEY, JSON.stringify(pocket));
    storage.removeItem(EXPORTED_STORAGE_KEY);
    return pocket;
  });
}

export async function unlockPocket(pocket: StoredPocket, password: string): Promise<SessionSigner> {
  const provider = new JsonRpcProvider(POCKET_CONFIG.rpcUrl, POCKET_CONFIG.chainId);
  const wallet = new Wallet(await decryptPrivateKey(pocket, password), provider);
  if (wallet.address.toLowerCase() !== pocket.address.toLowerCase()) {
    throw new Error("The decrypted key does not belong to this pocket address.");
  }
  return wallet;
}

export async function exportPocketKey(pocket: StoredPocket, password: string): Promise<string> {
  const privateKey = await decryptPrivateKey(pocket, password);
  if (new Wallet(privateKey).address.toLowerCase() !== pocket.address.toLowerCase()) {
    throw new Error("The decrypted key does not belong to this pocket address.");
  }
  return privateKey;
}

export function verifyPocketBackup(address: string, privateKey: string, storage: PocketStorage): boolean {
  try {
    if (new Wallet(privateKey.trim()).address.toLowerCase() !== address.toLowerCase()) return false;
    storage.setItem(EXPORTED_STORAGE_KEY, address.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

function requireUsdtAddress(): string {
  if (!POCKET_CONFIG.usdtAddress) throw new Error("BSC USDT address is not configured.");
  return POCKET_CONFIG.usdtAddress;
}

export async function fundPocket(
  mainSigner: Signer,
  sessionAddress: string,
  amountUsdt: number,
  storage: PocketStorage,
): Promise<string> {
  if (!addressPattern.test(sessionAddress) || !Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    throw new Error("Invalid pocket funding request.");
  }
  if (amountUsdt > MAX_POCKET_FUND_USDT) throw new Error("Pocket funding exceeds the system limit.");
  if (!pocketBackupVerified(storage, sessionAddress)) throw new Error("Verify the pocket key backup before funding.");
  const network = await mainSigner.provider?.getNetwork();
  if (!network || network.chainId !== BigInt(POCKET_CONFIG.chainId)) throw new Error("Main signer must be connected to BNB Smart Chain.");
  const token = new Contract(requireUsdtAddress(), TOKEN_ABI, mainSigner);
  const transaction = await token.transfer(sessionAddress, parseUnits(String(amountUsdt), POCKET_CONFIG.usdtDecimals));
  await transaction.wait();
  return transaction.hash as string;
}

export async function withdrawPocket(
  sessionSigner: SessionSigner,
  pocketAddress: string,
  mainAddress: string,
  amountUsdt: number,
): Promise<string> {
  if (!addressPattern.test(mainAddress) || !Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    throw new Error("Invalid pocket withdrawal request.");
  }
  const signerAddress = await sessionSigner.getAddress();
  if (signerAddress.toLowerCase() !== pocketAddress.toLowerCase()) {
    throw new Error("Session signer does not match the pocket address.");
  }
  const token = new Contract(requireUsdtAddress(), TOKEN_ABI, sessionSigner);
  const transaction = await token.transfer(mainAddress, parseUnits(String(amountUsdt), POCKET_CONFIG.usdtDecimals));
  await transaction.wait();
  return transaction.hash as string;
}

export async function readPocketBalances(address: string): Promise<PocketBalances> {
  if (!addressPattern.test(address)) throw new Error("Invalid pocket address.");
  const provider = new JsonRpcProvider(POCKET_CONFIG.rpcUrl, POCKET_CONFIG.chainId);
  const token = new Contract(requireUsdtAddress(), TOKEN_ABI, provider);
  const [usdt, bnb] = await Promise.all([token.balanceOf(address), provider.getBalance(address)]);
  return {
    usdt: formatUnits(usdt, POCKET_CONFIG.usdtDecimals),
    bnb: formatUnits(bnb, 18),
  };
}

export async function readPocketAaplbBalance(address: string): Promise<string> {
  if (!addressPattern.test(address)) throw new Error("Invalid pocket address.");
  const provider = new JsonRpcProvider(POCKET_CONFIG.rpcUrl, POCKET_CONFIG.chainId);
  const token = new Contract(TOKENS.AAPLB.address, TOKEN_ABI, provider);
  const balance = await token.balanceOf(address);
  return formatUnits(balance, TOKENS.AAPLB.decimals);
}
