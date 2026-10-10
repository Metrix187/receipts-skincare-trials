import type { LedgerPort, LedgerReserve } from "./client";

export interface MemoryLedgerRow extends LedgerReserve {
  id: string;
  status: "reserved" | "charged" | "not_charged";
  taskId?: string;
  note?: string;
}

/** In-memory ledger for tests and scripts. The app uses the Prisma ledger. */
export class MemoryLedger implements LedgerPort {
  rows: MemoryLedgerRow[] = [];

  async reserve(entry: LedgerReserve) {
    const id = `l${this.rows.length + 1}`;
    this.rows.push({ ...entry, id, status: "reserved" });
    return id;
  }
  async attachTask(id: string, taskId: string) {
    this.find(id).taskId = taskId;
  }
  async settle(id: string, outcome: { status: "charged" | "not_charged"; note?: string }) {
    Object.assign(this.find(id), outcome);
  }
  async liveUnitsCommitted() {
    return this.rows
      .filter((r) => !r.mock && r.status !== "not_charged")
      .reduce((sum, r) => sum + r.units, 0);
  }
  private find(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no ledger row ${id}`);
    return row;
  }
}
