import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Bus, connectBus } from "@ac/bus";
import {
  type DecisionRecord,
  type DecisionStatus,
  type EmittedEventRecord,
  openDecisions,
  readDecisions,
  type ToolCallRecord,
  writeDecision,
} from "@ac/decisions";
import {
  type Envelope,
  EVENT_TYPES,
  type EventType,
  newEvent,
  type PayloadOf,
  payloads,
} from "@ac/events";
import { type Logger, log as makeLog } from "@ac/log";
import Anthropic from "@anthropic-ai/sdk";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";

/** `agent.json`: the shape every agent declares (landscape #5, design §12 step 5). */
export const AgentConfigSchema = z.object({
  name: z.string().min(1),
  queue: z.string().min(1),
  consumes: z.array(z.enum(EVENT_TYPES)).min(1),
  emits: z.array(z.enum(EVENT_TYPES)),
  /** Allow-list of MCP tools and `read_decisions`. `emit_event` and `done` are always there. Absent = all. */
  tools: z.array(z.string()).optional(),
  limits: z
    .object({
      max_calls: z.number().int().positive().default(8),
      max_tokens: z.number().int().positive().default(4096),
      timeout_ms: z.number().int().positive().default(60_000),
      effort: z.enum(["low", "medium", "high"]).optional(),
    })
    .default({ max_calls: 8, max_tokens: 4096, timeout_ms: 60_000 }),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

type Tool = Anthropic.Beta.BetaTool;
type ToolOutcome = { ok: boolean; text: string };
type TurnContext = { event: Envelope; decision_id: string; queued: Envelope[]; done: boolean };
type LocalTool = { tool: Tool; run: (input: unknown, ctx: TurnContext) => Promise<ToolOutcome> };

/** What a scripted agent (`scripted.ts`) gets. The same tools and checks as the model gets. */
export type ScriptedApi = {
  event: Envelope;
  /** Calls a tool. Returns the parsed JSON result. Throws on an error result (for example a guard refusal). */
  // biome-ignore lint/suspicious/noExplicitAny: tool results are JSON of many shapes
  call: <T = any>(tool: string, args: Record<string, unknown>) => Promise<T>;
  /** Queues an event through `emit_event`: the same allow-list and schema check. */
  emit: <T extends EventType>(
    type: T,
    payload: PayloadOf<T>,
    options?: { draft_id?: string | null; offer_version?: number | null },
  ) => Promise<void>;
  log: Logger;
};
/** A scripted agent: fixed rules, no model. Used when AGENT_MODE=scripted (demo fallback, tests). */
export type Scripted = (api: ScriptedApi) => Promise<string | undefined>;

const textOf = (content: unknown): string => {
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((block: { type?: string; text?: string }) =>
      block.type === "text" ? (block.text ?? "") : JSON.stringify(block),
    )
    .join("\n");
};

/** The event as the model sees it. */
export function render(event: Envelope): string {
  return [
    `Event: ${event.type}`,
    `event_id: ${event.event_id}`,
    `occurred_at: ${event.occurred_at}`,
    `draft_id: ${event.draft_id ?? "null"}`,
    `offer_version: ${event.offer_version ?? "null"}`,
    `decision_id of the producer: ${event.decision_id ?? "null"}`,
    "payload:",
    JSON.stringify(event.payload, null, 2),
  ].join("\n");
}

const schemaOf = (s: z.ZodType) => z.toJSONSchema(s) as Tool["input_schema"];

function localTools(
  config: AgentConfig,
  decisions: Awaited<ReturnType<typeof openDecisions>>,
): LocalTool[] {
  const tools: LocalTool[] = [];

  if (config.emits.length > 0) {
    const emits = config.emits as [EventType, ...EventType[]];
    const EmitInput = z.object({
      type: z.enum(emits).describe("One of the event types this agent may emit"),
      payload: z.record(z.string(), z.unknown()).describe("The payload for that event type"),
      draft_id: z
        .string()
        .nullable()
        .optional()
        .describe("Defaults to the draft_id of the event you received"),
      offer_version: z.number().int().positive().nullable().optional(),
    });
    tools.push({
      tool: {
        name: "emit_event",
        description:
          "Publishes one event to the bus after this turn ends. Allowed only for the event types in your emits list; the payload must match the schema of that type.",
        input_schema: schemaOf(EmitInput),
      },
      run: async (raw, ctx) => {
        const input = EmitInput.safeParse(raw);
        if (!input.success)
          return { ok: false, text: `emit_event rejected: ${z.prettifyError(input.error)}` };
        const payload = payloads[input.data.type].safeParse(input.data.payload);
        if (!payload.success) {
          return {
            ok: false,
            text: `payload for ${input.data.type} rejected: ${z.prettifyError(payload.error)}`,
          };
        }
        const event = newEvent({
          type: input.data.type,
          payload: payload.data as never,
          draft_id: input.data.draft_id === undefined ? ctx.event.draft_id : input.data.draft_id,
          offer_version:
            input.data.offer_version === undefined
              ? ctx.event.offer_version
              : input.data.offer_version,
          decision_id: ctx.decision_id,
        });
        ctx.queued.push(event);
        return { ok: true, text: `queued ${event.type} ${event.event_id}` };
      },
    });
  }

  const DoneInput = z.object({
    summary: z.string().describe("One or two sentences on what you decided"),
  });
  tools.push({
    tool: {
      name: "done",
      description: "Ends this turn. Call it when nothing more is needed.",
      input_schema: schemaOf(DoneInput),
    },
    run: async (raw, ctx) => {
      const input = DoneInput.safeParse(raw);
      ctx.done = true;
      return { ok: true, text: input.success ? input.data.summary : "done" };
    },
  });

  const ReadInput = z.object({ decision_ids: z.array(z.string()).min(1) });
  tools.push({
    tool: {
      name: "read_decisions",
      description:
        "Reads decision records by id. Use it to explain, from the record, why an earlier agent decided something.",
      input_schema: schemaOf(ReadInput),
    },
    run: async (raw) => {
      const input = ReadInput.safeParse(raw);
      if (!input.success) return { ok: false, text: z.prettifyError(input.error) };
      const rows = await readDecisions(decisions, input.data.decision_ids);
      return { ok: true, text: JSON.stringify(rows, null, 2) };
    },
  });

  return tools;
}

type McpTool = { tool: Tool; client: Client };

/** The decision id of the running turn. One turn at a time per process (prefetch 1). */
let currentDecision: string | null = null;

const fetchWithDecision: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (currentDecision) headers.set("x-decision-id", currentDecision);
  return fetch(input, { ...init, headers });
};

async function connectMcp(urls: string[], agentName: string, log: Logger): Promise<McpTool[]> {
  const result: McpTool[] = [];
  for (const url of urls) {
    let client: Client | undefined;
    for (let attempt = 1; !client; attempt++) {
      try {
        const c = new Client({ name: `agent-${agentName}`, version: "0.1.0" });
        await c.connect(
          new StreamableHTTPClientTransport(new URL(url), { fetch: fetchWithDecision }),
        );
        client = c;
      } catch (error) {
        if (attempt >= 30) throw error;
        log.warn({ url, attempt }, "mcp server not ready; retry in 2 s");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const { tools } = await client.listTools();
    for (const t of tools) {
      if (result.some((r) => r.tool.name === t.name)) {
        log.warn({ tool: t.name, url }, "duplicate tool name; first server wins");
        continue;
      }
      result.push({
        client,
        tool: {
          name: t.name,
          description: t.description ?? "",
          input_schema: t.inputSchema as Tool["input_schema"],
        },
      });
    }
    log.info({ url, tools: tools.map((t) => t.name) }, "mcp server connected");
  }
  return result;
}

/**
 * Starts an agent from its directory: `agent.json`, `prompt.md`, and `scripted.ts` for AGENT_MODE=scripted.
 * One bounded turn per event (design rule 3); the loop is landscape §8.
 */
export async function runAgent(dir: string): Promise<void> {
  const config = AgentConfigSchema.parse(
    JSON.parse(await readFile(path.join(dir, "agent.json"), "utf8")),
  );
  const system = await readFile(path.join(dir, "prompt.md"), "utf8");
  const log = makeLog(`agent-${config.name}`);
  const scriptedMode = process.env.AGENT_MODE === "scripted";
  const model = scriptedMode ? "scripted" : (process.env.MODEL_NAME ?? "claude-opus-5-5");
  const scripted: Scripted | undefined = scriptedMode
    ? (await import(path.join(dir, "scripted.ts"))).default
    : undefined;
  const anthropic = scriptedMode ? undefined : new Anthropic();

  const decisions = await openDecisions(
    process.env.DECISIONS_DATABASE_URL ?? "postgres://ac:ac@postgres:5432/decisions",
    log,
  );
  const mcpUrls = (process.env.MCP_SERVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = (name: string) =>
    name === "emit_event" || name === "done" || !config.tools || config.tools.includes(name);
  const mcpTools = (await connectMcp(mcpUrls, config.name, log)).filter((t) =>
    allowed(t.tool.name),
  );
  const locals = localTools(config, decisions).filter((t) => allowed(t.tool.name));
  const tools: Tool[] = [...mcpTools.map((t) => t.tool), ...locals.map((t) => t.tool)];
  const bus: Bus = await connectBus(process.env.AMQP_URL ?? "amqp://ac:ac@rabbitmq:5672", log);

  async function runTool(name: string, input: unknown, ctx: TurnContext): Promise<ToolOutcome> {
    const local = locals.find((t) => t.tool.name === name);
    if (local) return local.run(input, ctx);
    const remote = mcpTools.find((t) => t.tool.name === name);
    if (!remote) return { ok: false, text: `unknown or not allowed tool ${name}` };
    const result = await remote.client.callTool({
      name,
      arguments: input as Record<string, unknown>,
    });
    return { ok: !result.isError, text: textOf(result.content) };
  }

  type TurnResult = {
    status: DecisionStatus;
    outputText: string;
    tokensIn: number;
    tokensOut: number;
  };

  async function modelTurn(
    event: Envelope,
    ctx: TurnContext,
    toolCalls: ToolCallRecord[],
  ): Promise<TurnResult> {
    if (!anthropic) throw new Error("no model client");
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: render(event) }];
    const signal = AbortSignal.timeout(config.limits.timeout_ms);
    const r: TurnResult = { status: "limit", outputText: "", tokensIn: 0, tokensOut: 0 };
    for (let call = 0; call < config.limits.max_calls && !ctx.done; call++) {
      const reply = await anthropic.beta.messages.create(
        {
          model,
          max_tokens: config.limits.max_tokens,
          system,
          tools,
          messages,
          ...(config.limits.effort ? { output_config: { effort: config.limits.effort } } : {}),
          // Refusal fallback: on a policy decline the API re-runs the request on a fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );
      r.tokensIn += reply.usage.input_tokens;
      r.tokensOut += reply.usage.output_tokens;
      const text = reply.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) r.outputText = text;
      if (reply.stop_reason === "refusal") {
        r.status = "error";
        log.warn({ decision_id: ctx.decision_id }, "model refused");
        return r;
      }
      if (reply.stop_reason === "max_tokens") {
        r.status = "limit";
        log.warn({ decision_id: ctx.decision_id }, "max_tokens reached");
        return r;
      }
      const uses = reply.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      if (uses.length === 0) {
        r.status = "ok";
        return r;
      }
      messages.push({ role: "assistant", content: reply.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const outcome = await runTool(use.name, use.input, ctx);
        toolCalls.push({
          name: use.name,
          input: use.input,
          ok: outcome.ok,
          result: outcome.text.slice(0, 2000),
        });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: outcome.text,
          is_error: !outcome.ok,
        });
        log.info({ decision_id: ctx.decision_id, tool: use.name, ok: outcome.ok }, "tool call");
      }
      messages.push({ role: "user", content: results });
      if (ctx.done) r.status = "ok";
    }
    return r;
  }

  async function scriptedTurn(
    event: Envelope,
    ctx: TurnContext,
    toolCalls: ToolCallRecord[],
  ): Promise<TurnResult> {
    if (!scripted) throw new Error("no scripted.ts");
    const api: ScriptedApi = {
      event,
      log,
      async call(name, args) {
        if (!allowed(name)) throw new Error(`tool ${name} is not in agent.json tools`);
        const outcome = await runTool(name, args, ctx);
        toolCalls.push({ name, input: args, ok: outcome.ok, result: outcome.text.slice(0, 2000) });
        log.info({ decision_id: ctx.decision_id, tool: name, ok: outcome.ok }, "tool call");
        if (!outcome.ok) throw new Error(outcome.text);
        try {
          return JSON.parse(outcome.text);
        } catch {
          return outcome.text;
        }
      },
      async emit(type, payload, options) {
        const outcome = await runTool("emit_event", { type, payload, ...options }, ctx);
        toolCalls.push({ name: "emit_event", input: { type, payload }, ok: outcome.ok });
        if (!outcome.ok) throw new Error(outcome.text);
      },
    };
    const outputText = (await scripted(api)) ?? "";
    return { status: "ok", outputText, tokensIn: 0, tokensOut: 0 };
  }

  async function turn(event: Envelope): Promise<void> {
    const decision_id = randomUUID();
    const startedAt = new Date();
    const ctx: TurnContext = { event, decision_id, queued: [], done: false };
    const toolCalls: ToolCallRecord[] = [];
    let result: TurnResult = { status: "error", outputText: "", tokensIn: 0, tokensOut: 0 };
    let failure: unknown;
    currentDecision = decision_id;
    try {
      result = scriptedMode
        ? await scriptedTurn(event, ctx, toolCalls)
        : await modelTurn(event, ctx, toolCalls);
    } catch (error) {
      failure = error;
      result.status = "error";
      log.error({ err: error, decision_id }, "turn failed");
    } finally {
      currentDecision = null;
    }

    const emitted: EmittedEventRecord[] = ctx.queued.map((e) => ({
      type: e.type,
      event_id: e.event_id,
    }));
    const record: DecisionRecord = {
      decision_id,
      agent: config.name,
      event_id: event.event_id,
      event_type: event.type,
      draft_id: event.draft_id,
      offer_version: event.offer_version,
      model,
      started_at: startedAt.toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      tool_calls: toolCalls,
      emitted_events: result.status === "error" ? [] : emitted,
      output_text: result.outputText || (failure ? String((failure as Error).message) : ""),
      status: result.status,
    };
    await writeDecision(decisions, record);
    log.info(
      {
        decision_id,
        status: result.status,
        tool_calls: toolCalls.length,
        emitted: emitted.map((e) => e.type),
      },
      "decision",
    );

    if (result.status === "error") throw failure ?? new Error("turn ended with an error");
    for (const queued of ctx.queued) await bus.publish(queued);
  }

  await bus.consume(config.queue, config.consumes, turn);
  log.info(
    {
      queue: config.queue,
      consumes: config.consumes,
      emits: config.emits,
      model,
      tools: tools.map((t) => t.name),
    },
    "agent ready",
  );
}
