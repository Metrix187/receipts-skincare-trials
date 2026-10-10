import { describe, expect, it } from "vitest";
import { YouCamClient, normalizeOutput, type FetchLike } from "@/lib/youcam/client";
import { unitsPerAnalysis, projectTrialUnits } from "@/lib/youcam/costs";
import { YouCamError } from "@/lib/youcam/errors";
import { MemoryLedger } from "@/lib/youcam/ledger-memory";
import { createMockFetch } from "@/lib/youcam/mock";
import hdFixture from "@/lib/youcam/fixtures/skin-analysis-hd-success.json";
import type { SkinOutputItem } from "@/lib/youcam/types";

/** Fake clock shared by the mock server and the client's sleep(). */
function harness(opts: { rateLimitFirst?: number; mock?: boolean; unitBudget?: number; wrap?: (f: FetchLike) => FetchLike } = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const base = createMockFetch({ now: () => clock, runningMs: 2_500, rateLimitFirst: opts.rateLimitFirst });
  const recording: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    return base(url, init);
  };
  const ledger = new MemoryLedger();
  const client = new YouCamClient({
    apiKey: "test-key",
    fetch: opts.wrap ? opts.wrap(recording) : recording,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ledger,
    mock: opts.mock ?? true,
    unitBudget: opts.unitBudget,
  });
  return { client, ledger, sleeps, calls };
}

const jpeg = new Uint8Array(2048).fill(7);
const submit = { bytes: jpeg, contentType: "image/jpeg" as const, fileName: "rcpt_day1.jpg", tier: "sd" as const };

describe("costs", () => {
  it("matches the live feature-cost table", () => {
    expect(unitsPerAnalysis("sd", 1)).toBe(9);
    expect(unitsPerAnalysis("sd", 4)).toBe(9);
    expect(unitsPerAnalysis("sd", 5)).toBe(12);
    expect(unitsPerAnalysis("sd", 16)).toBe(16);
    expect(unitsPerAnalysis("hd", 4)).toBe(12);
    expect(unitsPerAnalysis("hd", 13)).toBe(22);
    expect(() => unitsPerAnalysis("sd", 0)).toThrow(RangeError);
  });

  it("projects a 21-day SD trial at 189 units", () => {
    expect(projectTrialUnits({ tier: "sd", concernCount: 3, days: 21 })).toEqual({ unitsPerCall: 9, calls: 21, totalUnits: 189 });
  });

  it("agrees with the mock feature-cost endpoint (fixture of the live response)", async () => {
    const { client } = harness();
    const skus = await client.getFeatureCosts();
    const sd14 = skus.find((s) => s.description.includes("V2.1 SD (1-4"));
    expect(sd14?.amount).toBe(unitsPerAnalysis("sd", 4));
  });
});

describe("YouCamClient.analyzeSkin (mock transport)", () => {
  it("uploads, creates a task, polls with backoff and normalizes scores", async () => {
    const { client, ledger, sleeps, calls } = harness();
    const result = await client.analyzeSkin({ ...submit, concerns: ["redness", "texture", "radiance"] });

    expect(result.units).toBe(9);
    expect(result.scores.map((s) => s.concern).sort()).toEqual(["radiance", "redness", "texture"]);
    for (const s of result.scores) {
      expect(s.uiScore).toBeGreaterThanOrEqual(1);
      expect(s.uiScore).toBeLessThanOrEqual(100);
      expect(s.maskUrls).toHaveLength(1);
    }
    expect(result.skinAge).toBeTypeOf("number");
    // Backoff: 1000, 1500 (then the task is done at >= 2500ms).
    expect(sleeps).toEqual([1000, 1500]);
    expect(ledger.rows).toMatchObject([{ status: "charged", units: 9, mock: true, concernCount: 3 }]);

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("authorization")).toBeNull(); // never leak the key to S3
    expect(put.headers.get("content-length")).toBeNull(); // fetch derives it
    expect(put.headers.get("content-type")).toBe("image/jpeg");
    const task = calls.find((c) => c.url.endsWith("/s2s/v2.1/task/skin-analysis"))!;
    expect(task.headers.get("authorization")).toBe("Bearer test-key");
  });

  it("retries 429s on safe calls with backoff", async () => {
    const { client, sleeps } = harness({ rateLimitFirst: 2 });
    const res = await client.analyzeSkin({ ...submit, concerns: ["redness"] });
    expect(res.scores).toHaveLength(1);
    // two rate-limit retries (equal jitter with random=0.5 -> 0.75 * exp) before polling
    expect(sleeps.slice(0, 2)).toEqual([375, 750]);
  });

  it("never retries task creation on 5xx (a duplicate task would be charged twice)", async () => {
    let taskPosts = 0;
    const { client, ledger } = harness({
      wrap: (f) => async (url, init) => {
        if (url.endsWith("/task/skin-analysis") && init?.method === "POST") {
          taskPosts++;
          return new Response(JSON.stringify({ status: 500, error: "boom" }), { status: 500 });
        }
        return f(url, init);
      },
    });
    await expect(client.analyzeSkin({ ...submit, concerns: ["redness"] })).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(taskPosts).toBe(1);
    expect(ledger.rows[0].status).toBe("not_charged");
  });

  it("surfaces engine errors with a code and does not charge", async () => {
    const { client, ledger } = harness();
    const err = await client
      .analyzeSkin({ ...submit, fileName: "noface.jpg", concerns: ["acne"] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(YouCamError);
    expect(err).toMatchObject({ kind: "engine", code: "error_no_face" });
    expect(ledger.rows[0].status).toBe("not_charged");
  });

  it("rejects mixed HD/SD before spending anything", async () => {
    const { client, calls } = harness();
    // Concern keys map to one tier, so mixing only happens at the raw endpoint.
    await expect(
      client.createSkinAnalysisTask({ src_file_id: "x", dst_actions: ["redness", "hd_pore"], format: "json" }),
    ).rejects.toMatchObject({ kind: "http", status: 400, code: "InvalidParameters" });
    expect(calls).toHaveLength(1);
  });

  it("rejects unknown dst_actions with InvalidParameters", async () => {
    const { client } = harness();
    await expect(
      client.createSkinAnalysisTask({ src_file_id: "x", dst_actions: ["abc123"], format: "json" }),
    ).rejects.toMatchObject({ code: "InvalidParameters", message: "Not available dst_action abc123" });
  });

  it("enforces the live unit budget before uploading", async () => {
    const { client, calls } = harness({ mock: false, unitBudget: 5 });
    await expect(client.analyzeSkin({ ...submit, concerns: ["redness"] })).rejects.toMatchObject({ kind: "budget" });
    expect(calls).toHaveLength(0);
  });

  it("times out polling without failing the task, and can resume", async () => {
    const { client } = harness();
    const task = await client.submitSkinAnalysis({ ...submit, concerns: ["pore"] });
    const err = await client.resolveSkinAnalysis(task, { timeoutMs: 500 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "timeout", opts: { taskId: task.taskId } });
    const res = await client.resolveSkinAnalysis(task);
    expect(res.scores[0].concern).toBe("pore");
  });

  it("serves real PNG masks in mock mode", async () => {
    const { client } = harness();
    const res = await client.analyzeSkin({ ...submit, concerns: ["redness"] });
    const png = await client.downloadMask(res.scores[0].maskUrls[0]);
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("reads the credit balance", async () => {
    const { client } = harness();
    expect((await client.getCredits()).spendable).toBe(1000);
  });
});

describe("normalizeOutput (official V2.1 example)", () => {
  const out = normalizeOutput(hdFixture.data.results.output as SkinOutputItem[]);

  it("extracts overall score and skin age", () => {
    expect(out.overall).toBe(28.5);
    expect(out.skinAge).toBe(29);
  });

  it("keeps regions, maps actions to concerns, drops resize_image", () => {
    expect(out.scores).toHaveLength(12);
    expect(out.scores.filter((s) => s.concern === "pore").map((s) => s.region)).toEqual(["whole", "forehead", "nose", "cheek"]);
    const skin = out.scores.find((s) => s.concern === "skin_type" && s.region === "t_zone");
    expect(skin).toMatchObject({ uiScore: null, skinType: "Oily" });
    expect(out.scores.find((s) => s.concern === "acne")).toMatchObject({ uiScore: 13, rawScore: 12.5, action: "hd_acne" });
  });
});
