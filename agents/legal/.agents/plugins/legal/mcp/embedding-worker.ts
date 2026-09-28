import { CourtListenerEmbedder } from './embeddings.ts';

declare const self: Worker;

let embedder: Promise<CourtListenerEmbedder> | undefined;
self.onmessage = async (event: MessageEvent<{ text: string }>) => {
  try {
    embedder ??= CourtListenerEmbedder.load();
    const vector = await (await embedder).embed(event.data.text);
    self.postMessage({ vector });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
