// Typed client for the YouCam AI Skin Analysis API (v2.1).
//
// Flow (all documented at docs.perfectcorp.com/reference/ai_skin_analysis):
//   1. POST /s2s/v2.0/file                      -> file_id + pre-signed PUT url   (free)
//   2. PUT  <pre-signed url>                    -> upload bytes                   (free)
//   3. POST /s2s/v2.1/task/skin-analysis        -> task_id                        (charged on success)
//   4. GET  /s2s/v2.1/task/skin-analysis/{id}   -> running | success | error      (free)
//
// Retry policy: GETs, file-init and the PUT retry on 429 / 5xx / network errors with
// exponential backoff + jitter. Task creation retries ONLY on 429, because a 5xx or a
// dropped connection may still have created a task, and a duplicate task would be
// charged twice.
//
// Every task goes through the unit ledger: reserve before creating the task, settle
// as `charged` on success or `not_charged` on any failure.

import { actionFor, concernFromAction, isHdAction, type ConcernKey, type Tier } from "./concerns";
import { unitsPerAnalysis } from "./costs";
import { YouCamError } from "./errors";
import type {
  ApiErrorBody,
  ConcernScore,
  CreditResponse,
  FeatureCostResponse,
  FileInitResponse,
  RunTaskResponse,
  SkinAnalysisResult,
  SkinAnalysisTaskRequest,
  SkinOutputItem,
  TaskStatusResponse,
} from "./types";

export const SKIN_ANALYSIS_PATH = "/s2s/v2.1/task/skin-analysis";
export const FILE_PATH = "/s2s/v2.0/file";
export const CREDIT_PATH = "/s2s/v1.0/client/credit";
export const FEATURE_COST_PATH = "/s2s/v2.0/credit/feature-cost";

export interface LedgerReserve {
  feature: "skin-analysis";
  tier: Tier;
  concernCount: number;
  units: number;
  mock: boolean;
  trialId?: string;
  captureId?: string;
}

export interface LedgerPort {
  reserve(entry: LedgerReserve): Promise<string>;
  attachTask(id: string, taskId: string): Promise<void>;
  settle(id: string, outcome: { status: "charged" | "not_charged"; note?: string }): Promise<void>;
  /** Units charged (or still reserved) against real YouCam, for the budget guard. */
  liveUnitsCommitted(): Promise<number>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface YouCamClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Random source for jitter (injectable for tests). */
  random?: () => number;
  ledger?: LedgerPort;
  /** Marks ledger rows; a mock client never spends units. */
  mock?: boolean;
  /** Refuse to create live tasks past this many committed units. */
  unitBudget?: number;
  retry?: Partial<RetryPolicy>;
  poll?: Partial<PollPolicy>;
  onEvent?: (e: { type: string; [k: string]: unknown }) => void;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface PollPolicy {
  initialDelayMs: number;
  factor: number;
  maxDelayMs: number;
  timeoutMs: number;
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 8_000 };
// Docs suggest ~10s polling; analysis usually finishes in a few seconds, so start
// fast and back off. 250 req / 300 s per key leaves plenty of headroom.
const DEFAULT_POLL: PollPolicy = { initialDelayMs: 1_000, factor: 1.5, maxDelayMs: 8_000, timeoutMs: 90_000 };

export interface SubmitArgs {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png";
  fileName: string;
  concerns: ConcernKey[];
  tier: Tier;
  /** true = one blended overlay JPG; false (default) = one raw mask PNG per concern. */
  maskOverlay?: boolean;
  ledgerContext?: { trialId?: string; captureId?: string };
}

export interface SubmittedTask {
  taskId: string;
  fileId: string;
  ledgerId: string | null;
  units: number;
  tier: Tier;
}

export class YouCamClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly retry: RetryPolicy;
  private readonly pollPolicy: PollPolicy;

  constructor(private readonly opts: YouCamClientOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://yce-api-01.makeupar.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
    this.pollPolicy = { ...DEFAULT_POLL, ...opts.poll };
  }

  get isMock() {
    return !!this.opts.mock;
  }

  // ---- low-level -------------------------------------------------------------

  private emit(type: string, data: Record<string, unknown> = {}) {
    this.opts.onEvent?.({ type, ...data });
  }

  private backoff(attempt: number, retryAfter?: string | null) {
    const ra = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, this.retry.maxDelayMs);
    const exp = Math.min(this.retry.baseDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
    return exp / 2 + (this.random() * exp) / 2; // "equal jitter"
  }

  private async send(
    method: "GET" | "POST" | "PUT",
    url: string,
    init: { body?: BodyInit; headers?: Record<string, string>; auth?: boolean; retryOn: "safe" | "429-only" },
  ): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers };
    if (init.auth !== false) headers.Authorization = `Bearer ${this.opts.apiKey}`;

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body: init.body });
      } catch (err) {
        const canRetry = init.retryOn === "safe" && attempt < this.retry.maxAttempts;
        this.emit("network_error", { url: redact(url), attempt, retrying: canRetry });
        if (!canRetry) {
          throw new YouCamError(`Network error calling ${method} ${redact(url)}: ${String(err)}`, "network", {
            retryable: true,
          });
        }
        await this.sleep(this.backoff(attempt));
        continue;
      }
      const retryable = res.status === 429 || (init.retryOn === "safe" && res.status >= 500);
      if (retryable && attempt < this.retry.maxAttempts) {
        const delay = this.backoff(attempt, res.headers.get("retry-after"));
        this.emit("retry", { url: redact(url), status: res.status, attempt, delayMs: Math.round(delay) });
        await this.sleep(delay);
        continue;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new YouCamError(body.error ?? `HTTP ${res.status} from ${method} ${redact(url)}`, "http", {
          status: res.status,
          code: body.error_code,
          retryable,
        });
      }
      return res;
    }
  }

  private json(method: "GET" | "POST", path: string, body?: unknown, retryOn: "safe" | "429-only" = "safe") {
    return this.send(method, `${this.baseUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      retryOn,
    }).then((r) => r.json());
  }

  // ---- endpoints --------------------------------------------------------------

  async initUpload(meta: { contentType: string; fileName: string; fileSize: number }) {
    const res = (await this.json("POST", FILE_PATH, {
      files: [{ content_type: meta.contentType, file_name: meta.fileName, file_size: meta.fileSize }],
    })) as FileInitResponse;
    const file = res.data?.files?.[0];
    const put = file?.requests?.[0];
    if (!file?.file_id || !put?.url) {
      throw new YouCamError("File init response missing file_id or upload URL", "http");
    }
    return { fileId: file.file_id, put };
  }

  async uploadBytes(put: { url: string; headers: Record<string, string> }, bytes: Uint8Array) {
    // Send the pre-signed headers verbatim except Content-Length, which fetch derives
    // from the body (and some runtimes reject when set by hand).
    const headers = Object.fromEntries(
      Object.entries(put.headers ?? {}).filter(([k]) => k.toLowerCase() !== "content-length"),
    );
    await this.send("PUT", put.url, {
      body: bytes as unknown as BodyInit,
      headers,
      auth: false,
      retryOn: "safe",
    });
  }

  async createSkinAnalysisTask(req: SkinAnalysisTaskRequest): Promise<string> {
    const res = (await this.json("POST", SKIN_ANALYSIS_PATH, req, "429-only")) as RunTaskResponse;
    if (!res.data?.task_id) throw new YouCamError("Task response missing task_id", "http");
    return res.data.task_id;
  }

  async getTask(taskId: string) {
    return (await this.json("GET", `${SKIN_ANALYSIS_PATH}/${encodeURIComponent(taskId)}`)) as TaskStatusResponse;
  }

  /**
   * Polls until success/error or the timeout elapses. A timeout is NOT a failure of
   * the task: results stay retrievable for 24h, so callers can resume with the same id.
   */
  async pollTask(taskId: string, opts: { timeoutMs?: number } = {}) {
    const timeoutMs = opts.timeoutMs ?? this.pollPolicy.timeoutMs;
    let delay = this.pollPolicy.initialDelayMs;
    let waited = 0;
    for (let i = 0; ; i++) {
      const res = await this.getTask(taskId);
      const status = res.data?.task_status;
      this.emit("poll", { taskId: shortId(taskId), i, status });
      if (status === "success" || status === "error") return res.data;
      if (waited + delay > timeoutMs) {
        throw new YouCamError(`Task still running after ${waited}ms`, "timeout", { taskId, retryable: true });
      }
      await this.sleep(delay);
      waited += delay;
      delay = Math.min(delay * this.pollPolicy.factor, this.pollPolicy.maxDelayMs);
    }
  }

  async getCredits() {
    const res = (await this.json("GET", CREDIT_PATH)) as CreditResponse;
    const spendable = res.results
      .filter((r) => r.type.startsWith("Api"))
      .reduce((sum, r) => sum + (r.amount ?? 0), 0);
    return { spendable, batches: res.results };
  }

  async getFeatureCosts(filter = "skin-analysis") {
    const skus: FeatureCostResponse["result"]["skus"] = [];
    let token: string | null | undefined;
    do {
      const q = new URLSearchParams({ page_size: "20" });
      if (token) q.set("starting_token", token);
      const res = (await this.json("GET", `${FEATURE_COST_PATH}?${q}`)) as FeatureCostResponse;
      skus.push(...(res.result?.skus ?? []));
      token = res.result?.next_token;
    } while (token);
    return skus.filter((s) => s.run_task_url.includes(filter));
  }

  /** Download a result mask (pre-signed S3 URL, no auth header). */
  async downloadMask(url: string): Promise<Uint8Array> {
    const res = await this.send("GET", url, { auth: false, retryOn: "safe" });
    return new Uint8Array(await res.arrayBuffer());
  }

  // ---- high-level ---------------------------------------------------------------

  /** Steps 1-3. Returns as soon as the task exists (serverless-friendly). */
  async submitSkinAnalysis(args: SubmitArgs): Promise<SubmittedTask> {
    const actions = [...new Set(args.concerns)].map((c) => actionFor(c, args.tier));
    if (actions.length === 0) throw new YouCamError("No concerns requested", "validation");
    if (new Set(actions.map(isHdAction)).size > 1) {
      throw new YouCamError("Cannot mix HD and SD concerns in one task", "validation");
    }
    const units = unitsPerAnalysis(args.tier, actions.length);

    if (!this.isMock && this.opts.unitBudget && this.opts.ledger) {
      const committed = await this.opts.ledger.liveUnitsCommitted();
      if (committed + units > this.opts.unitBudget) {
        throw new YouCamError(
          `Unit budget guard: ${committed} units committed + ${units} would exceed YOUCAM_UNIT_BUDGET=${this.opts.unitBudget}`,
          "budget",
        );
      }
    }

    const { fileId, put } = await this.initUpload({
      contentType: args.contentType,
      fileName: args.fileName,
      fileSize: args.bytes.byteLength,
    });
    await this.uploadBytes(put, args.bytes);

    const ledgerId =
      (await this.opts.ledger?.reserve({
        feature: "skin-analysis",
        tier: args.tier,
        concernCount: actions.length,
        units,
        mock: this.isMock,
        ...args.ledgerContext,
      })) ?? null;

    try {
      const taskId = await this.createSkinAnalysisTask({
        src_file_id: fileId,
        dst_actions: actions,
        format: "json",
        miniserver_args: { enable_mask_overlay: !!args.maskOverlay },
      });
      if (ledgerId) await this.opts.ledger!.attachTask(ledgerId, taskId);
      this.emit("task_created", { taskId: shortId(taskId), units, actions });
      return { taskId, fileId, ledgerId, units, tier: args.tier };
    } catch (err) {
      if (ledgerId) await this.opts.ledger!.settle(ledgerId, { status: "not_charged", note: String(err) });
      throw err;
    }
  }

  /** Step 4. Settles the ledger row on a terminal status. */
  async resolveSkinAnalysis(task: SubmittedTask, opts: { timeoutMs?: number } = {}): Promise<SkinAnalysisResult> {
    const data = await this.pollTask(task.taskId, opts);
    if (data.task_status === "error") {
      if (task.ledgerId) {
        await this.opts.ledger?.settle(task.ledgerId, { status: "not_charged", note: data.error ?? "error" });
      }
      throw new YouCamError(data.error_message ?? data.error ?? "Analysis failed", "engine", {
        code: data.error ?? undefined,
        taskId: task.taskId,
      });
    }
    if (task.ledgerId) await this.opts.ledger?.settle(task.ledgerId, { status: "charged" });
    const output = extractOutput(data.results);
    return {
      taskId: task.taskId,
      fileId: task.fileId,
      units: task.units,
      mock: this.isMock,
      ...normalizeOutput(output),
    };
  }

  /** Convenience: submit + resolve in one call (scripts, tests). */
  async analyzeSkin(args: SubmitArgs, opts: { timeoutMs?: number } = {}) {
    return this.resolveSkinAnalysis(await this.submitSkinAnalysis(args), opts);
  }
}

function extractOutput(results: TaskStatusResponse["data"]["results"]): SkinOutputItem[] {
  if (results && typeof results === "object" && "output" in results && Array.isArray(results.output)) {
    return results.output;
  }
  throw new YouCamError("Expected format=json results with an output[] array", "http");
}

/** Pure: API output[] -> scores per concern/region, plus overall score and skin age. */
export function normalizeOutput(output: SkinOutputItem[]) {
  const scores: ConcernScore[] = [];
  let overall: number | null = null;
  let skinAge: number | null = null;
  for (const item of output) {
    if (item.type === "all") {
      overall = item.score ?? null;
      continue;
    }
    if (item.type === "skin_age") {
      skinAge = item.score ?? null;
      continue;
    }
    const info = concernFromAction(item.type);
    if (!info) continue; // e.g. resize_image
    scores.push({
      concern: info.key,
      action: item.type,
      region: item.region ?? "whole",
      uiScore: typeof item.ui_score === "number" ? item.ui_score : null,
      rawScore: typeof item.raw_score === "number" ? item.raw_score : null,
      skinType: item.skin_type,
      maskUrls: item.mask_urls ?? [],
    });
  }
  return { scores, overall, skinAge };
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Strip pre-signed query strings from URLs before they reach logs. */
function redact(url: string) {
  const i = url.indexOf("?");
  return i === -1 ? url : `${url.slice(0, i)}?…`;
}
