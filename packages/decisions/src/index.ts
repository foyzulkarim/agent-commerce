import path from "node:path";
import { type Pool, query, startDatabase } from "@ac/db";
import type { Logger } from "@ac/log";

export type DecisionStatus = "ok" | "limit" | "error";

export type ToolCallRecord = { name: string; input: unknown; ok: boolean; result?: unknown };
export type EmittedEventRecord = { type: string; event_id: string };

/** One row of `decision_records` (design §14). */
export type DecisionRecord = {
  decision_id: string;
  agent: string;
  event_id: string;
  event_type: string;
  draft_id: string | null;
  offer_version: number | null;
  model: string;
  started_at: string;
  duration_ms: number;
  tokens_in: number;
  tokens_out: number;
  tool_calls: ToolCallRecord[];
  emitted_events: EmittedEventRecord[];
  output_text: string;
  status: DecisionStatus;
};

export const migrationsDir = path.join(import.meta.dirname, "..", "migrations");

/** Opens the `decisions` database and applies its migration. Every agent calls this at start. */
export function openDecisions(databaseUrl: string, log: Logger): Promise<Pool> {
  return startDatabase({ databaseUrl, migrationsDir, log });
}

export async function writeDecision(pool: Pool, record: DecisionRecord): Promise<void> {
  await query(
    pool,
    `INSERT INTO decision_records
       (decision_id, agent, event_id, event_type, draft_id, offer_version, model, started_at,
        duration_ms, tokens_in, tokens_out, tool_calls, emitted_events, output_text, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      record.decision_id,
      record.agent,
      record.event_id,
      record.event_type,
      record.draft_id,
      record.offer_version,
      record.model,
      record.started_at,
      record.duration_ms,
      record.tokens_in,
      record.tokens_out,
      JSON.stringify(record.tool_calls),
      JSON.stringify(record.emitted_events),
      record.output_text,
      record.status,
    ],
  );
}

/** The rows for the given ids, in `started_at` order. Used by the Notification agent (G2). */
export async function readDecisions(pool: Pool, decisionIds: string[]): Promise<DecisionRecord[]> {
  if (decisionIds.length === 0) return [];
  const result = await query<DecisionRecord>(
    pool,
    "SELECT * FROM decision_records WHERE decision_id = ANY($1::uuid[]) ORDER BY started_at",
    [decisionIds],
  );
  return result.rows;
}
