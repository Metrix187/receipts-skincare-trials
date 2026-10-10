// Wire types for the YouCam v2 S2S API, transcribed from the official OpenAPI bundle
// (ai_skin_analysis.yaml, V2.1) and verified against live responses where marked.

export interface FileInitRequest {
  files: { content_type: "image/jpeg" | "image/png"; file_name: string; file_size: number }[];
}

export interface FileInitResponse {
  status: number;
  data: {
    files: {
      content_type: string;
      file_name: string;
      file_id: string;
      requests: { method: "PUT"; url: string; headers: Record<string, string> }[];
    }[];
  };
}

export interface SkinAnalysisTaskRequest {
  src_file_id?: string;
  src_file_url?: string;
  dst_actions: string[];
  format: "json" | "zip";
  miniserver_args?: {
    enable_mask_overlay?: boolean;
    [k: string]: unknown;
  };
}

export interface RunTaskResponse {
  status: number;
  data: { task_id: string };
}

export type TaskStatus = "running" | "success" | "error";

export interface SkinOutputItem {
  /** dst_action name, or "skin_age" | "all" | "resize_image" */
  type: string;
  region?: string;
  raw_score?: number;
  ui_score?: number;
  /** For type "all" / "skin_age". */
  score?: number;
  /** For *skin_type. */
  skin_type?: string;
  mask_urls?: string[];
}

export interface TaskStatusResponse {
  status: number;
  data: {
    task_status: TaskStatus;
    error?: string | null;
    error_message?: string;
    results?: { output: SkinOutputItem[] } | { url: string } | string;
  };
}

/** GET /s2s/v1.0/client/credit (verified live 2026-10-10). */
export interface CreditResponse {
  status: number;
  results: { id: number; type: string; amount: number; amount_dec?: number; expiry?: number }[];
}

/** GET /s2s/v2.0/credit/feature-cost (verified live; page_size max 20). */
export interface FeatureCostResponse {
  status: number;
  result: {
    skus: { description: string; amount: number; unit: string; proc_unit: number; run_task_url: string }[];
    next_token?: string | null;
  };
}

/** Error body shape for 4xx responses. */
export interface ApiErrorBody {
  status: number;
  error?: string;
  error_code?: "InvalidParameters" | "CreditInsufficiency" | "BadRequest" | string;
}

// ---- Normalized result our app stores ---------------------------------------

export interface ConcernScore {
  /** our ConcernKey, e.g. "redness" */
  concern: string;
  action: string;
  region: string;
  uiScore: number | null;
  rawScore: number | null;
  skinType?: string;
  maskUrls: string[];
}

export interface SkinAnalysisResult {
  taskId: string;
  fileId: string;
  scores: ConcernScore[];
  overall: number | null;
  skinAge: number | null;
  units: number;
  mock: boolean;
}
