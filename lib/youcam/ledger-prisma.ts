import "server-only";
import { db } from "@/lib/db";
import type { LedgerPort, LedgerReserve } from "./client";

export const prismaLedger: LedgerPort = {
  async reserve(e: LedgerReserve) {
    const row = await db.unitLedger.create({ data: { ...e, status: "reserved" } });
    return row.id;
  },
  async attachTask(id, taskId) {
    await db.unitLedger.update({ where: { id }, data: { taskId } });
  },
  async settle(id, outcome) {
    await db.unitLedger.update({ where: { id }, data: { status: outcome.status, note: outcome.note?.slice(0, 500) } });
  },
  async liveUnitsCommitted() {
    const agg = await db.unitLedger.aggregate({
      where: { mock: false, status: { in: ["reserved", "charged"] } },
      _sum: { units: true },
    });
    return agg._sum.units ?? 0;
  },
};

/** Ledger summary for the settings page and README screenshots. */
export async function ledgerSummary() {
  const rows = await db.unitLedger.groupBy({
    by: ["mock", "status", "tier"],
    _sum: { units: true },
    _count: { _all: true },
  });
  const pick = (mock: boolean, status: string) =>
    rows.filter((r) => r.mock === mock && r.status === status).reduce((s, r) => s + (r._sum.units ?? 0), 0);
  const count = (mock: boolean) => rows.filter((r) => r.mock === mock).reduce((s, r) => s + r._count._all, 0);
  return {
    live: { charged: pick(false, "charged"), reserved: pick(false, "reserved"), notCharged: pick(false, "not_charged"), tasks: count(false) },
    mock: { charged: pick(true, "charged"), tasks: count(true) },
    recent: await db.unitLedger.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  };
}
