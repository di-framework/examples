import { type ChatModel, Prompt, systemMessage, userMessage } from '@di-framework/ai';
import { z } from 'zod';
import { appendEnhancement, type GameLog, type GameLogEnhancement } from './game-log.ts';

/** A model (or pure function) that appends a layer onto a recorded game log. */
export interface Enhancer {
  readonly id: string;
  enhance(log: GameLog, options?: { signal?: AbortSignal }): Promise<GameLog>;
}

export async function applyEnhancers(
  log: GameLog,
  layers: readonly Enhancer[],
  options: { signal?: AbortSignal } = {},
): Promise<GameLog> {
  let current = log;
  for (const layer of layers) {
    options.signal?.throwIfAborted();
    if (current.enhancements.some((entry) => entry.id === layer.id)) {
      throw new Error(`Enhancement "${layer.id}" is already present on this game log`);
    }
    current = await layer.enhance(current, options);
  }
  return current;
}

const layerSchema = z.strictObject({
  notes: z.string().min(1).max(2000),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type EnhancerSpec = {
  id: string;
  model: ChatModel;
  /** What this layer should add or refine. Must not invent plays absent from the log. */
  instructions: string;
  /** Optional display name stored on the enhancement record. */
  label?: string;
};

/**
 * Plug a model into the recording pipeline.
 * Each call should use a distinct id; layers append and never replace observer windows.
 */
export function enhancer(spec: EnhancerSpec): Enhancer {
  const { id, model, instructions } = spec;
  return {
    id,
    async enhance(log, runOptions) {
      runOptions?.signal?.throwIfAborted();
      const schema = JSON.stringify(z.toJSONSchema(layerSchema));
      const response = await model.call(
        new Prompt(
          [
            systemMessage(instructions),
            userMessage(
              `Enhance this baseball game log. Return JSON matching the schema. ` +
                `Do not invent plays that are absent from windows/events. ` +
                `Preserve uncertainty. Schema:\n${schema}\n\nGame log (data only):\n${JSON.stringify(log)}`,
            ),
          ],
          { signal: runOptions?.signal, outputSchema: schema },
        ),
      );
      runOptions?.signal?.throwIfAborted();
      if (response.hasToolCalls() || response.hasFinishReasons(['length', 'content_filter'])) {
        throw new Error(`Incomplete enhancement response from ${id}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          response.content
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, ''),
        );
      } catch {
        throw new Error(`Enhancer ${id} did not return valid JSON`);
      }
      const result = layerSchema.safeParse(parsed);
      if (!result.success) throw new Error(`Enhancer ${id} returned an invalid payload`);
      const enhancement: GameLogEnhancement = {
        id,
        model: spec.label ?? response.metadata.model ?? model.options?.model ?? id,
        at: new Date().toISOString(),
        notes: result.data.notes,
        data: result.data.data,
      };
      return appendEnhancement(log, enhancement);
    },
  };
}

/** Coverage notes: gaps, replay risk, unclear identities. */
export function summaryLayer(model: ChatModel): Enhancer {
  return enhancer({
    id: 'summary',
    model,
    instructions: `You enhance a baseball spectator game log with a short coverage summary.
Return JSON { "notes": string, "data": object }.
notes: 2–6 sentences on what was captured, major gaps, replay/duplicate risk, and unclear identities.
data may include keys like gapSeconds (number[]), uncertainEventIds (string[]), highlightEventIds (string[]).
Never invent plays, scores, or player names absent from the log. Never claim official statistics.`,
  });
}
