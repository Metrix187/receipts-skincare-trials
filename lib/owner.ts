import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { DEMO_OWNER, OWNER_COOKIE } from "./owner-cookie";

export async function ownerId(): Promise<string> {
  return (await cookies()).get(OWNER_COOKIE)?.value ?? "anonymous";
}

/** Trials the current browser may see: its own, plus read-only demo trials. */
export async function findVisibleTrial(id: string) {
  const owner = await ownerId();
  const trial = await db.trial.findUnique({ where: { id } });
  if (!trial) return null;
  if (trial.ownerId !== owner && !trial.isDemo) return null;
  return { trial, canEdit: trial.ownerId === owner && !trial.isDemo };
}

/** Throws unless the current browser owns this (non-demo) trial. */
export async function requireOwnedTrial(id: string) {
  const found = await findVisibleTrial(id);
  if (!found?.canEdit) throw new HttpError(404, "Trial not found");
  return found.trial;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export { DEMO_OWNER };
