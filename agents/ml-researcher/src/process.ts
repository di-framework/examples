import { spawn } from 'node:child_process';

export interface ProcessRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  input?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string>;
}
export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
}
export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;

/** No shell interpolation; cancellation terminates the process group on Unix. */
export const runProcess: ProcessRunner = async (request) => {
  request.signal?.throwIfAborted();
  const timeout = request.timeoutMs ?? 600_000;
  if (!Number.isFinite(timeout) || timeout < 1) throw new Error('timeoutMs must be positive');
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      cancelled = false,
      timedOut = false,
      truncated = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    const stop = () => {
      kill('SIGTERM');
      escalation ??= setTimeout(() => kill('SIGKILL'), 250);
    };
    const abort = () => {
      cancelled = true;
      stop();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      // Kill surviving descendants even if the leader exited on SIGTERM.
      if (cancelled || timedOut) kill('SIGKILL');
      clearTimeout(escalation);
      request.signal?.removeEventListener('abort', abort);
    };
    const append = (value: string, chunk: string) => {
      const combined = value + chunk;
      if (combined.length > 65_536) truncated = true;
      return combined.slice(0, 65_536);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = append(stderr, chunk);
    });
    child.stdin.on('error', () => {}); // A rejected command may close stdin before reading.
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      cleanup();
      resolve({
        code,
        stdout,
        stderr,
        cancelled,
        timedOut,
        durationMs: Date.now() - started,
        truncated,
      });
    });
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    child.stdin.end(request.input);
  });
};

export function assertProcess(result: ProcessResult): ProcessResult {
  if (result.cancelled) throw new Error('Command cancelled');
  if (result.timedOut) throw new Error('Command timed out');
  if (result.code !== 0)
    throw new Error(`Command failed (${result.code}): ${result.stderr || result.stdout}`);
  return result;
}
