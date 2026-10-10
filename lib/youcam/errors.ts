export type YouCamErrorKind = "http" | "engine" | "timeout" | "budget" | "network" | "validation";

export class YouCamError extends Error {
  constructor(
    message: string,
    readonly kind: YouCamErrorKind,
    readonly opts: { status?: number; code?: string; taskId?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "YouCamError";
  }
  get status() {
    return this.opts.status;
  }
  get code() {
    return this.opts.code;
  }
}

/**
 * Plain-language retake guidance for engine error codes. Engine errors consume
 * no units, so the UI can offer an immediate retake.
 */
export const RETAKE_GUIDANCE: Record<string, string> = {
  error_no_face: "No face found. Center your face inside the outline.",
  error_large_face_angle: "Your head is turned. Look straight into the camera.",
  error_src_face_too_small: "Move closer: your face should fill most of the frame.",
  error_src_face_out_of_bound: "Part of your face is outside the frame.",
  error_lighting_dark: "Too dark. Face a window or turn on a light in front of you.",
  error_below_min_image_size: "Image resolution is too low for analysis.",
  error_exceed_max_image_size: "Image is too large.",
  exceed_max_filesize: "Image file is over 10 MB.",
  error_face_parsing: "Couldn't map facial regions. Remove glasses, pull hair back, retake.",
  error_multiple_people: "Only one face should be in frame.",
  error_nsfw_content_detected: "Image was rejected by the provider's content filter.",
  error_decode_image: "Image couldn't be decoded. Try again.",
  error_inference: "The analysis engine hiccuped. Retake (no units were charged).",
  unknown_internal_error: "Provider error. Retake (no units were charged).",
};

export function retakeGuidance(code?: string | null) {
  return (code && RETAKE_GUIDANCE[code]) || "Analysis failed. Retake (no units were charged).";
}
