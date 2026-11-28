/**
 * Optional: hands questions the parser can't read to a language model. The
 * model only translates the question into an `Intent` (a JSON object
 * constrained by a schema); it never sees or writes data. The intent then goes
 * through the same `buildQuery` and executor as the parser's, so every figure
 * still comes from the dashboard's own series.
 *
 * Enabled when Anthropic credentials are present (ANTHROPIC_API_KEY or
 * ANTHROPIC_AUTH_TOKEN), or with ASK_ENABLED=1 for a stored `ant auth login`
 * profile. ASK_ENABLED=0 turns it off.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Catalog, Intent } from "@shared/query.ts";
import { emptyIntent } from "@shared/query.ts";
import { coerceIntent, intentSchema, questionMessage, systemPrompt } from "@shared/nl/model.ts";
import { logger } from "./logger.ts";

export const askConfig = {
  enabled:
    process.env.ASK_ENABLED === "0"
      ? false
      : process.env.ASK_ENABLED === "1" || Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  model: process.env.ASK_MODEL ?? "claude-opus-5-5",
  /** Requests per minute across all visitors; each question is a paid API call. */
  perMinute: Number(process.env.ASK_PER_MINUTE ?? 20),
};

export class AskUnavailableError extends Error {}

export function createTranslator() {
  let client: Anthropic | null = null;
  const recent: number[] = [];

  return {
    available: () => askConfig.enabled,

    async translate(text: string, catalog: Catalog, currentYear: number): Promise<Intent> {
      if (!askConfig.enabled) throw new AskUnavailableError("No language model is configured on this server.");
      const now = Date.now();
      while (recent.length && now - recent[0]! > 60_000) recent.shift();
      if (recent.length >= askConfig.perMinute) throw new AskUnavailableError("Too many questions this minute; try again shortly.");
      recent.push(now);

      client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
      const started = performance.now();
      const res = await client.beta.messages.create({
        model: askConfig.model,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: intentSchema(catalog) } },
        system: [{ type: "text", text: systemPrompt(catalog), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: questionMessage(text, currentYear) }],
      });
      logger.info(
        `ask: ${Math.round(performance.now() - started)}ms, ${res.usage.input_tokens} in (+${res.usage.cache_read_input_tokens ?? 0} cached), ${res.usage.output_tokens} out, stop ${res.stop_reason}`,
      );
      if (res.stop_reason === "refusal") return { ...emptyIntent(), kind: "unsupported", reason: "unclear" };
      if (res.stop_reason === "max_tokens") throw new Error("The model's reply was cut off.");
      const body = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      try {
        return coerceIntent(JSON.parse(body));
      } catch {
        throw new Error("The model's reply wasn't valid JSON.");
      }
    },
  };
}

export type Translator = ReturnType<typeof createTranslator>;
