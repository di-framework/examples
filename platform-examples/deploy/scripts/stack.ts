/**
 * Runs after `bun install`: selects (or creates) stack `dev` in the project's local file
 * backend and points the platform at the container CLI this machine has.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chooseContainerCli } from '../src/meshtastic';

const STACK = 'dev';
const root = `${__dirname}/..`;

function run(args: string[], quiet = false): { ok: boolean; stdout: string } {
  const result = spawnSync('pulumi', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '' };
}

if (spawnSync('pulumi', ['version'], { stdio: 'ignore' }).status !== 0) {
  console.warn('pulumi is not installed; install it, then run `bun install` again.');
  process.exit(0);
}
if (!process.env.PULUMI_CONFIG_PASSPHRASE && !process.env.PULUMI_CONFIG_PASSPHRASE_FILE) {
  console.warn('Set PULUMI_CONFIG_PASSPHRASE (see the README), then run `bun install` again.');
  process.exit(0);
}
// Pulumi.yaml points the backend at this directory; it must exist.
mkdirSync(`${root}/.pulumi-state`, { recursive: true });
if (!run(['stack', 'select', '--create', STACK]).ok) process.exit(1);
if (!run(['config', 'get', 'containerCli'], true).ok) {
  const cli = chooseContainerCli(
    (name) => spawnSync(name, ['version'], { stdio: 'ignore' }).status === 0,
  );
  if (!cli) {
    console.error('Neither docker nor podman works on this machine.');
    process.exit(1);
  }
  if (!run(['config', 'set', 'containerCli', cli]).ok) process.exit(1);
  console.log(`Stack ${STACK} uses ${cli}.`);
}
