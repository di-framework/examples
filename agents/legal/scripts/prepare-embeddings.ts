import { fileURLToPath } from 'node:url';
import { verifyEmbeddings } from './verify-embeddings.ts';

const exportProcess = Bun.spawn(
  ['uv', 'run', fileURLToPath(new URL('./export-embeddings.py', import.meta.url))],
  { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
);
if ((await exportProcess.exited) !== 0) throw new Error('Embedding export failed');
await verifyEmbeddings();
