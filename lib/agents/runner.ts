import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// A small manual agent loop over the Messages API (tool use).
//
// Why manual instead of the SDK tool runner: we need (1) a complete, replayable
// transcript of every turn for the UI ("how the agent reasoned"), and (2) a terminal
// `submit_*` tool whose input is validated server-side. An invalid submission goes
// back to the model as an error tool_result so it can fix it, instead of ending the run.
//
// Model notes (claude-opus-5-5): thinking is always on (we ask for summarized
// display so the reasoning is readable), effort is set explicitly, forced tool_choice
// is unsupported (so `auto` + `strict` schemas + a prompt instruction), and
// server-side refusal fallback is enabled.

export type TranscriptEntry =
  | { kind: "user"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; name: string; output: unknown; isError: boolean }
  | { kind: "note"; text: string };

export class ToolInputError extends Error {}

export interface AgentTool {
  name: string;
  description: string;
  /** Strict-mode JSON schema: additionalProperties false, all properties required, no min/max. */
  input_schema: Record<string, unknown>;
  run(input: unknown): Promise<unknown>;
  /** If true, a successful call ends the run and its return value is the agent's output. */
  terminal?: boolean;
}

export interface AgentRunResult<T> {
  output: T;
  transcript: TranscriptEntry[];
  usage: { input: number; output: number };
  turns: number;
  model: string;
  mock: boolean;
}

export async function runLiveAgent<T>(opts: {
  system: string;
  prompt: string;
  tools: AgentTool[];
  maxTurns?: number;
}): Promise<AgentRunResult<T>> {
  const e = env();
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: 120_000 });
  const transcript: TranscriptEntry[] = [{ kind: "user", text: opts.prompt }];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
    strict: true,
  }));
  const terminalName = opts.tools.find((t) => t.terminal)?.name;
  const usage = { input: 0, output: 0 };
  let nudges = 0;

  for (let turn = 1; turn <= (opts.maxTurns ?? 14); turn++) {
    const res = await client.beta.messages.create({
      model: e.ANTHROPIC_MODEL,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: e.ANTHROPIC_EFFORT },
      system: opts.system,
      tools,
      messages,
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;

    if (res.stop_reason === "refusal") {
      transcript.push({ kind: "note", text: `Model declined (${res.stop_details?.category ?? "unknown"}).` });
      throw new AgentError("The model declined this request.", transcript, usage);
    }

    for (const block of res.content) {
      if (block.type === "thinking" && block.thinking) transcript.push({ kind: "thinking", text: block.thinking });
      else if (block.type === "text" && block.text.trim()) transcript.push({ kind: "text", text: block.text });
      else if (block.type === "tool_use") transcript.push({ kind: "tool_call", id: block.id, name: block.name, input: block.input });
    }
    // Append the full content (thinking blocks included) so the history stays append-only.
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason === "max_tokens") {
      throw new AgentError("The agent ran out of output tokens.", transcript, usage);
    }

    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      if (nudges++ >= 2) throw new AgentError(`The agent stopped without calling ${terminalName}.`, transcript, usage);
      const text = `Please finish by calling ${terminalName} with your final answer.`;
      transcript.push({ kind: "user", text });
      messages.push({ role: "user", content: text });
      continue;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let output: T | undefined;
    for (const call of calls) {
      const tool = opts.tools.find((t) => t.name === call.name);
      let out: unknown;
      let isError = false;
      try {
        if (!tool) throw new ToolInputError(`Unknown tool ${call.name}`);
        out = await tool.run(call.input);
        if (tool.terminal) output = out as T;
      } catch (err) {
        if (!(err instanceof ToolInputError)) throw err;
        isError = true;
        out = { error: err.message };
      }
      transcript.push({ kind: "tool_result", id: call.id, name: call.name, output: out, isError });
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out), is_error: isError });
    }
    // All results for one assistant turn go back in a single user message.
    messages.push({ role: "user", content: results });
    if (output !== undefined) {
      return { output, transcript, usage, turns: turn, model: e.ANTHROPIC_MODEL, mock: false };
    }
  }
  throw new AgentError("The agent hit its turn limit.", transcript, usage);
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly transcript: TranscriptEntry[],
    readonly usage: { input: number; output: number },
  ) {
    super(message);
  }
}

/** Persists one agent run (success or failure) for the reasoning log. */
export async function recordAgentRun(args: {
  trialId: string | null;
  agent: "protocol" | "verdict";
  input: unknown;
  started: number;
  result?: AgentRunResult<unknown>;
  error?: unknown;
  status?: "ok" | "error" | "overridden";
}) {
  const e = env();
  const err = args.error instanceof AgentError ? args.error : null;
  return db.agentRun.create({
    data: {
      trialId: args.trialId,
      agent: args.agent,
      model: args.result?.model ?? (e.agentsMock ? "mock-deterministic" : e.ANTHROPIC_MODEL),
      mock: args.result?.mock ?? e.agentsMock,
      status: args.status ?? (args.error ? "error" : "ok"),
      input: args.input as object,
      transcript: (args.result?.transcript ?? err?.transcript ?? []) as object,
      output: (args.result?.output ?? null) as object,
      error: args.error ? String(args.error instanceof Error ? args.error.message : args.error) : null,
      inputTokens: args.result?.usage.input ?? err?.usage.input ?? null,
      outputTokens: args.result?.usage.output ?? err?.usage.output ?? null,
      durationMs: Date.now() - args.started,
    },
  });
}

/** Builds a strict-mode object schema: every property required, no extras. */
export function strictObject(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
