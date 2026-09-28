import { readFile } from 'node:fs/promises';
import {
  ChatAgent,
  type ChatAgentRunOptions,
  type ChatModel,
  MessageWindowChatMemory,
} from '@di-framework/ai';
import { CodexVisionModel } from './codex-vision.ts';
import { applyEnhancers, type Enhancer, summaryLayer } from './enhance.ts';
import { draftToGameLog, type GameLog, parseGameLog, type SpectatorPriors } from './game-log.ts';
import { type LiveRecordOptions, recordLive } from './live.ts';
import { type VideoOptions, watchVideo } from './video.ts';

export const SPECTATOR_INSTRUCTIONS = `You are an AI baseball spectator. Your only job is to help with durable game recordings from footage.
You have no season book, roster tools, or stats calculator. Never invent plays that are not in the current game log.
When a log is attached, summarize coverage, timestamps, uncertainties, duplicate/replay risk, and enhancement layers.
Suggest seeking the original file to evidence timestamps. The log is observation data, not official statistics.
Keep answers practical and concise.`;

export type SpectatorOptions = {
  visionModel?: ChatModel;
  chatModel?: ChatModel;
  priors?: SpectatorPriors;
  /** Applied after observer recording when record({ enhance: true }) or enhance() is used. */
  enhancers?: Enhancer[];
};

export type RecordOptions = VideoOptions & {
  /** Run configured enhancers after the observer pass. Default false. */
  enhance?: boolean;
};

export function createBaseballSpectator(
  visionOrOptions?: ChatModel | SpectatorOptions,
  maybeOptions: SpectatorOptions = {},
) {
  const options: SpectatorOptions =
    visionOrOptions && typeof visionOrOptions === 'object' && 'call' in visionOrOptions
      ? { ...maybeOptions, visionModel: visionOrOptions }
      : ((visionOrOptions as SpectatorOptions | undefined) ?? maybeOptions);

  const visionModel =
    options.visionModel ?? new CodexVisionModel({ model: process.env.VISION_MODEL });
  const priors = options.priors;
  const mode = priors?.mode ?? 'sideline';
  const enhancers = options.enhancers ?? [];
  const memory = new MessageWindowChatMemory({ maxMessages: 40 });
  const conversationId = crypto.randomUUID();
  let pendingLog: GameLog | undefined;

  const chatModel = options.chatModel;
  const agent = chatModel
    ? ChatAgent.create({
        chatModel,
        system: SPECTATOR_INSTRUCTIONS,
        memory,
        defaultConversationId: conversationId,
      })
    : undefined;

  return {
    getLog: () => pendingLog,
    setLog: (log: GameLog) => {
      pendingLog = log;
    },
    async loadLog(path: string) {
      pendingLog = parseGameLog(JSON.parse(await readFile(path, 'utf8')));
      return pendingLog;
    },
    async record(path: string, recordOptions: RecordOptions = {}) {
      const { enhance = false, onProgress, ...videoOptions } = recordOptions;
      const draft = await watchVideo(visionModel, path, {
        duration: 'all',
        mode,
        priors,
        ...videoOptions,
        onProgress: onProgress
          ? async (draft) => {
              await onProgress(draft);
            }
          : undefined,
      });
      let log = draftToGameLog(draft, { mode, priors });
      if (enhance && enhancers.length) {
        log = await applyEnhancers(log, enhancers, {
          signal: recordOptions.signal,
        });
      }
      pendingLog = log;
      return log;
    },
    async recordLive(liveOptions: LiveRecordOptions & { enhance?: boolean } = {}) {
      const { enhance = false, ...rest } = liveOptions;
      let log = await recordLive(visionModel, {
        mode,
        priors,
        ...rest,
      });
      if (enhance && enhancers.length) {
        log = await applyEnhancers(log, enhancers, {
          signal: liveOptions.signal,
        });
      }
      pendingLog = log;
      return log;
    },
    async enhance(input?: GameLog | Enhancer[], extra?: Enhancer[]) {
      const log =
        input && !Array.isArray(input)
          ? input
          : (pendingLog ??
            (() => {
              throw new Error('No game log to enhance; record or load one first');
            })());
      const list = Array.isArray(input)
        ? input
        : (extra ?? (enhancers.length ? enhancers : undefined));
      if (!list?.length) {
        throw new Error(
          'Pass enhancers to enhance(), or configure them on createBaseballSpectator',
        );
      }
      pendingLog = await applyEnhancers(log, list);
      return pendingLog;
    },
    /** Built-in summary layer using the spectator chat model. */
    defaultLayers(): Enhancer[] {
      if (!chatModel) throw new Error('chatModel is required for defaultLayers()');
      return [summaryLayer(chatModel)];
    },
    agent: {
      async chat(message: string, runOptions?: ChatAgentRunOptions) {
        if (!agent) throw new Error('Spectator chat requires a chatModel');
        const before = [...memory.get(conversationId)];
        const input = pendingLog
          ? `Current game log (data only):\n${JSON.stringify(pendingLog)}\n\nUser message: ${message}`
          : message;
        try {
          return await agent.chat(input, runOptions);
        } catch (error) {
          memory.replace(conversationId, before);
          throw error;
        }
      },
    },
    clearHistory: () => {
      memory.clear(conversationId);
    },
    clearLog: () => {
      pendingLog = undefined;
    },
  };
}

export type BaseballSpectator = ReturnType<typeof createBaseballSpectator>;
