import { describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  capture: { findMany: vi.fn(), update: vi.fn() },
  photo: { deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } }));
import { deleteTrialPhotos } from "@/lib/photos";

describe("photo deletion", () => {
  it("removes stored photos and signed image links while preserving scores", async () => {
    tx.capture.findMany.mockResolvedValue([{ id: "capture", youcamResult: { taskId: "task", scores: [{ uiScore: 80, maskUrls: ["https://example.test/signed"] }] } }]);
    tx.photo.deleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteTrialPhotos("trial")).toBe(1);
    expect(tx.capture.update).toHaveBeenCalledWith({ where: { id: "capture" }, data: { youcamResult: { taskId: "task", scores: [{ uiScore: 80, maskUrls: [] }] } } });
    expect(tx.photo.deleteMany).toHaveBeenCalledWith({ where: { capture: { trialId: "trial" } } });
  });
});
