import { agentLimitsOff, POCKET_CONFIG } from "./config";
import type { AgentJobStatus, Job } from "./types";

export interface PocketJobStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PocketJobLock {
  request<T>(name: string, task: () => Promise<T>): Promise<T>;
}

export type SpendReservation =
  | { status: "reserved"; job: Job; amountUsdt: number }
  | { status: "empty"; job: Job }
  | { status: "inactive"; job: Job }
  | { status: "already_run"; job: Job }
  | { status: "cap_reached"; job: Job };

const JOB_PREFIX = "stockx.agent-job.v2.";

function jobKey(address: string): string {
  return `${JOB_PREFIX}${address.toLowerCase()}`;
}

function lockKey(address: string): string {
  return `stockx.agent-job-lock.v2.${address.toLowerCase()}`;
}

function validateJob(value: unknown): Job {
  if (value == null || typeof value !== "object") throw new Error("Invalid stored pocket job.");
  const job = value as Partial<Job>;
  if (
    typeof job.id !== "string" || job.id.length === 0 ||
    !Number.isFinite(job.capUsdt) || job.capUsdt! <= 0 || job.capUsdt! > POCKET_CONFIG.systemJobCapUsdt ||
    !Number.isFinite(job.spentUsdt) || job.spentUsdt! < 0 ||
    !Number.isFinite(job.reservedUsdt) || job.reservedUsdt! < 0 ||
    job.spentUsdt! + job.reservedUsdt! > job.capUsdt! ||
    !(job.lastRunDay === null || (typeof job.lastRunDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(job.lastRunDay))) ||
    (job.status !== "active" && job.status !== "stopped")
  ) {
    throw new Error("Invalid stored pocket job.");
  }
  return job as Job;
}

function readOrCreate(storage: PocketJobStorage, address: string, capUsdt: number): Job {
  if (!Number.isFinite(capUsdt) || capUsdt <= 0 || capUsdt > POCKET_CONFIG.systemJobCapUsdt) {
    throw new Error("Invalid system-limited job cap.");
  }
  const key = jobKey(address);
  const stored = storage.getItem(key);
  if (stored !== null) return validateJob(JSON.parse(stored));
  const job: Job = {
    id: crypto.randomUUID(),
    capUsdt,
    spentUsdt: 0,
    reservedUsdt: 0,
    lastRunDay: null,
    status: "stopped",
  };
  storage.setItem(key, JSON.stringify(job));
  return job;
}

export function loadPocketJob(
  storage: PocketJobStorage,
  locks: PocketJobLock,
  address: string,
  capUsdt = POCKET_CONFIG.systemJobCapUsdt,
): Promise<Job> {
  return locks.request(lockKey(address), async () => readOrCreate(storage, address, capUsdt));
}

export function setPocketJobStatus(
  storage: PocketJobStorage,
  locks: PocketJobLock,
  address: string,
  status: AgentJobStatus,
): Promise<Job> {
  return locks.request(lockKey(address), async () => {
    const job = readOrCreate(storage, address, POCKET_CONFIG.systemJobCapUsdt);
    const updated = { ...job, status };
    storage.setItem(jobKey(address), JSON.stringify(updated));
    return updated;
  });
}

export function reservePocketJobSpend(
  storage: PocketJobStorage,
  locks: PocketJobLock,
  address: string,
  amountUsdt: number,
  availableUsdt: number,
  utcDay: string,
): Promise<SpendReservation> {
  return locks.request(lockKey(address), async () => {
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0 || !Number.isFinite(availableUsdt) || availableUsdt < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(utcDay)) {
      throw new Error("Invalid pocket spend reservation.");
    }
    const job = readOrCreate(storage, address, POCKET_CONFIG.systemJobCapUsdt);
    if (job.status !== "active") return { status: "inactive", job };
    if (!agentLimitsOff() && job.lastRunDay === utcDay) return { status: "already_run", job };
    if (availableUsdt < amountUsdt) {
      const emptyJob = { ...job, lastRunDay: utcDay };
      storage.setItem(jobKey(address), JSON.stringify(emptyJob));
      return { status: "empty", job: emptyJob };
    }
    if (!agentLimitsOff() && job.spentUsdt + job.reservedUsdt + amountUsdt > job.capUsdt) {
      const stopped = { ...job, status: "stopped" as const };
      storage.setItem(jobKey(address), JSON.stringify(stopped));
      return { status: "cap_reached", job: stopped };
    }
    const updated = { ...job, reservedUsdt: job.reservedUsdt + amountUsdt, lastRunDay: utcDay };
    storage.setItem(jobKey(address), JSON.stringify(updated));
    return { status: "reserved", job: updated, amountUsdt };
  });
}

export function releasePocketJobSpend(
  storage: PocketJobStorage,
  locks: PocketJobLock,
  address: string,
  reservation: Extract<SpendReservation, { status: "reserved" }>,
): Promise<Job> {
  return locks.request(lockKey(address), async () => {
    const job = readOrCreate(storage, address, reservation.job.capUsdt);
    if (job.id !== reservation.job.id || job.reservedUsdt < reservation.amountUsdt) {
      throw new Error("Pocket job reservation no longer matches stored state.");
    }
    const updated = { ...job, reservedUsdt: job.reservedUsdt - reservation.amountUsdt };
    storage.setItem(jobKey(address), JSON.stringify(updated));
    return updated;
  });
}

export function commitPocketJobSpend(
  storage: PocketJobStorage,
  locks: PocketJobLock,
  address: string,
  reservation: Extract<SpendReservation, { status: "reserved" }>,
): Promise<Job> {
  return locks.request(lockKey(address), async () => {
    const job = readOrCreate(storage, address, reservation.job.capUsdt);
    if (job.id !== reservation.job.id || job.reservedUsdt < reservation.amountUsdt) {
      throw new Error("Pocket job reservation no longer matches stored state.");
    }
    const updated = {
      ...job,
      reservedUsdt: job.reservedUsdt - reservation.amountUsdt,
      spentUsdt: job.spentUsdt + reservation.amountUsdt,
    };
    storage.setItem(jobKey(address), JSON.stringify(updated));
    return updated;
  });
}