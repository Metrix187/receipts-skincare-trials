// MOCK_YOUCAM=1 transport: a fetch() replacement that speaks the YouCam wire format.
//
// It sits *under* YouCamClient, so mock mode runs the exact same upload, retry,
// polling, ledger and normalization code as live mode. It is stateless: ids carry
// their own state (base64url JSON), so it survives serverless cold starts between
// the submit and poll requests.
//
// Response shapes are copied from the official OpenAPI examples (V2.1). Masks are
// real PNGs (alpha = detection), so the left/right mask-split pipeline also runs
// against mock data.

import { concernFromAction, isHdAction } from "./concerns";
import type { FetchLike } from "./client";
import featureCostFixture from "./fixtures/feature-cost.json";

const UPLOAD_HOST = "https://mock-upload.youcam.local";
const MASK_HOST = "https://mock-masks.youcam.local";

export interface MockOptions {
  baseUrl?: string;
  /** How long a task reports `running` before success (ms). */
  runningMs?: number;
  now?: () => number;
  credits?: number;
  /** Return 429 on the first N requests (to exercise retry). */
  rateLimitFirst?: number;
}

const b64 = {
  enc: (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url"),
  dec: <T>(s: string): T => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T,
};

/** FNV-1a 32-bit: tiny deterministic hash for seeding. */
export function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Typical population-ish ui_score centers, so mock dashboards look plausible.
const BASE_SCORE: Record<string, number> = {
  redness: 64, acne: 78, pore: 70, texture: 68, wrinkle: 74, age_spot: 72, oiliness: 60,
  moisture: 58, radiance: 66, firmness: 76, dark_circle: 62, eye_bag: 70, tear_trough: 72,
  droopy_upper_eyelid: 80, droopy_lower_eyelid: 78,
};

const HD_REGIONS: Record<string, string[]> = {
  hd_pore: ["whole", "forehead", "nose", "cheek"],
  hd_wrinkle: ["whole", "forehead", "glabellar", "crowfeet", "periocular", "nasolabial", "marionette"],
  hd_skin_type: ["whole", "t_zone", "u_zone"],
};

interface MockFile { n: string; s: number; t: number }
interface MockTask { f: string; a: string[]; t: number; o: boolean }
interface MockMask { seed: number; a: string; ui: number }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function createMockFetch(opts: MockOptions = {}): FetchLike {
  const base = (opts.baseUrl ?? "https://yce-api-01.makeupar.com").replace(/\/$/, "");
  const now = opts.now ?? Date.now;
  const runningMs = opts.runningMs ?? 1_800;
  let rateLimitLeft = opts.rateLimitFirst ?? 0;

  return async (input, init = {}) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const auth = new Headers(init.headers).get("authorization");

    if (url.origin === UPLOAD_HOST && method === "PUT") return new Response(null, { status: 200 });
    if (url.origin === MASK_HOST) return maskResponse(b64.dec<MockMask>(url.pathname.split("/").pop()!.replace(".png", "")));

    if (`${url.origin}` !== base) return json({ status: 404, error: "Not found" }, 404);
    if (!auth?.startsWith("Bearer ")) return json({ status: 401, error: "Invalid API key" }, 401);
    if (rateLimitLeft > 0) {
      rateLimitLeft--;
      return json({ status: 429, error: "Too many requests" }, 429);
    }

    const path = url.pathname;
    if (method === "POST" && path === "/s2s/v2.0/file") {
      const body = JSON.parse(String(init.body));
      const f = body.files?.[0];
      if (!f?.file_name || !f?.file_size) {
        return json({ status: 400, error: "files[0] requires file_name and file_size", error_code: "InvalidParameters" }, 400);
      }
      const fileId = b64.enc({ n: f.file_name, s: f.file_size, t: now() } satisfies MockFile);
      return json({
        status: 200,
        data: {
          files: [{
            content_type: f.content_type,
            file_name: f.file_name,
            file_id: fileId,
            requests: [{
              method: "PUT",
              url: `${UPLOAD_HOST}/demo/ttl30/${fileId}?X-Amz-Signature=mock`,
              headers: { "Content-Length": String(f.file_size), "Content-Type": f.content_type },
            }],
          }],
        },
      });
    }

    if (method === "POST" && path === "/s2s/v2.1/task/skin-analysis") {
      const body = JSON.parse(String(init.body));
      const actions: string[] = body.dst_actions ?? [];
      if (!body.src_file_id && !body.src_file_url) {
        return json({ status: 400, error: "src_file_id or src_file_url is required", error_code: "InvalidParameters" }, 400);
      }
      if (new Set(actions.map(isHdAction)).size > 1) {
        return json({ status: 400, error: "cannot mix HD and SD dst_actions", error_code: "InvalidParameters" }, 400);
      }
      const bad = actions.find((a) => !concernFromAction(a));
      if (bad) return json({ status: 400, error: `Not available dst_action ${bad}`, error_code: "InvalidParameters" }, 400);
      const taskId = b64.enc({
        f: body.src_file_id ?? body.src_file_url,
        a: actions,
        t: now(),
        o: !!body.miniserver_args?.enable_mask_overlay,
      } satisfies MockTask);
      return json({ status: 200, data: { task_id: taskId } });
    }

    const taskMatch = path.match(/^\/s2s\/v2\.1\/task\/skin-analysis\/(.+)$/);
    if (method === "GET" && taskMatch) {
      let task: MockTask;
      try {
        task = b64.dec<MockTask>(decodeURIComponent(taskMatch[1]));
      } catch {
        return json({ status: 400, error: "Invalid task ID" }, 400);
      }
      if (now() - task.t < runningMs) return json({ status: 200, data: { task_status: "running" } });
      const file = safeDec<MockFile>(task.f);
      // Test hook: a file name containing "noface" fails like a real engine error.
      if (file?.n.includes("noface")) {
        return json({ status: 200, data: { task_status: "error", error: "error_no_face", error_message: "No face detected on source image" } });
      }
      return json({ status: 200, data: { task_status: "success", results: { output: mockOutput(task, file) } } });
    }

    if (method === "GET" && path === "/s2s/v1.0/client/credit") {
      return json({ status: 200, results: [{ id: 1, type: "ApiPaygToken", amount: opts.credits ?? 1000, amount_dec: opts.credits ?? 1000 }] });
    }
    if (method === "GET" && path === "/s2s/v2.0/credit/feature-cost") {
      const size = Number(url.searchParams.get("page_size") ?? 20);
      if (size > 20) return json({ status: 400, error: "page_size is above the allowed maximum.", error_code: "InvalidParameters" }, 400);
      return json(featureCostFixture);
    }
    return json({ status: 404, error: `Mock has no route for ${method} ${path}` }, 404);
  };
}

function safeDec<T>(s: string): T | null {
  try {
    return b64.dec<T>(s);
  } catch {
    return null;
  }
}

function mockOutput(task: MockTask, file: MockFile | null) {
  const seed = fnv1a(`${file?.n ?? task.f}:${file?.s ?? 0}`);
  const rnd = prng(seed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7; // ~N(0,1)
  const out: Record<string, unknown>[] = [];
  const uis: number[] = [];

  for (const action of task.a) {
    const info = concernFromAction(action)!;
    const regions = isHdAction(action) ? (HD_REGIONS[action] ?? ["whole"]) : [undefined];
    for (const region of regions) {
      if (info.key === "skin_type") {
        out.push({
          type: action,
          ...(region ? { region } : {}),
          skin_type: region === "t_zone" ? "Oily" : "Combination",
          mask_urls: [`${MASK_HOST}/mask/${b64.enc({ seed, a: action, ui: 50 })}.png`],
        });
        continue;
      }
      const ui = Math.round(clamp((BASE_SCORE[info.key] ?? 70) + gauss() * 4, 1, 100));
      const raw = Math.round(clamp(ui * 0.85 + 8 + gauss() * 2, 1, 100) * 100) / 100;
      uis.push(ui);
      out.push({
        type: action,
        ...(region ? { region } : {}),
        raw_score: raw,
        ui_score: ui,
        mask_urls: [`${MASK_HOST}/mask/${b64.enc({ seed: seed ^ fnv1a(`${action}${region ?? ""}`), a: action, ui } satisfies MockMask)}.png`],
      });
    }
  }
  out.push({ type: "skin_age", score: 24 + Math.round(rnd() * 12) });
  out.push({ type: "all", score: uis.length ? Math.round((uis.reduce((a, b) => a + b, 0) / uis.length) * 100) / 100 : 0 });
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Mask PNG: transparent canvas with soft blobs on the face region. Coverage grows as
 * ui_score falls. Each side gets its own small random asymmetry and NO treatment
 * effect: mock mode never pretends a product works.
 */
async function maskResponse(m: MockMask) {
  const { default: sharp } = await import("sharp");
  const W = 256;
  const H = 256;
  const px = new Uint8Array(W * H * 4);
  const rnd = prng(m.seed);
  const coverage = ((100 - m.ui) / 100) * 0.4;
  const sideBias = [1 + (rnd() - 0.5) * 0.2, 1 + (rnd() - 0.5) * 0.2];
  const blobs = Math.round(coverage * 220);
  for (let b = 0; b < blobs; b++) {
    const side = b % 2;
    const cx = side === 0 ? 0.2 + rnd() * 0.28 : 0.52 + rnd() * 0.28;
    const cy = 0.3 + rnd() * 0.55;
    const r = (0.015 + rnd() * 0.03) * sideBias[side];
    for (let y = Math.floor((cy - r) * H); y <= Math.ceil((cy + r) * H); y++) {
      for (let x = Math.floor((cx - r) * W); x <= Math.ceil((cx + r) * W); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(x / W - cx, y / H - cy) / r;
        if (d > 1) continue;
        const i = (y * W + x) * 4;
        px[i] = 230;
        px[i + 1] = 60;
        px[i + 2] = 60;
        px[i + 3] = Math.max(px[i + 3], Math.round(255 * (1 - d * d)));
      }
    }
  }
  const png = await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } });
}
