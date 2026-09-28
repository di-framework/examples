export type Embed = (text: string, signal?: AbortSignal) => Promise<number[]>;

/** Serial requests reuse one WASM session. Cancellation discards the worker and its model. */
export class EmbeddingClient {
  private worker?: Worker;
  private queue: Promise<unknown> = Promise.resolve();
  private cancel?: (reason: Error) => void;
  private receive?: (data: { vector?: number[]; error?: string }) => void;
  private closed = false;

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL('./embedding-worker.ts', import.meta.url).href),
    private readonly timeoutMs = 60_000,
  ) {}

  readonly embed: Embed = (text, signal) => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const run = this.queue.then(() => {
      signal?.throwIfAborted();
      if (this.closed) throw new Error('Embedding client is closed');
      return new Promise<number[]>((resolve, reject) => {
        if (!this.worker) {
          const worker = this.createWorker();
          this.worker = worker;
          // Keep handlers installed across requests; only the pending recipient changes.
          worker.onmessage = (event) => {
            if (this.worker === worker) this.receive?.(event.data);
          };
          worker.onerror = (event) => {
            if (this.worker === worker)
              this.cancel?.(new Error(event.message || 'Embedding worker failed'));
          };
        }
        const worker = this.worker;
        const bounded = AbortSignal.any([
          AbortSignal.timeout(this.timeoutMs),
          ...(signal ? [signal] : []),
        ]);
        const cleanup = () => {
          bounded.removeEventListener('abort', abort);
          this.receive = undefined;
          this.cancel = undefined;
        };
        const fail = (reason: Error) => {
          cleanup();
          worker.terminate();
          this.worker = undefined;
          reject(reason);
        };
        const abort = () => fail(bounded.reason);
        this.receive = (data) => {
          if (data.error) return fail(new Error(data.error));
          if (!data.vector) return fail(new Error('Embedding worker returned no vector'));
          cleanup();
          resolve(data.vector);
        };
        this.cancel = fail;
        bounded.addEventListener('abort', abort, { once: true });
        try {
          worker.postMessage({ text });
        } catch (error) {
          fail(error as Error);
        }
      });
    });
    this.queue = run.catch(() => {});
    if (!signal) return run;
    // A cancelled queued request rejects promptly, without cancelling the request ahead of it.
    return new Promise<number[]>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };

  close() {
    this.closed = true;
    this.cancel?.(new Error('Embedding client is closed'));
    this.worker?.terminate();
    this.worker = undefined;
  }
}

const client = new EmbeddingClient();
export const localEmbedding = client.embed;
export const closeEmbeddings = () => client.close();
