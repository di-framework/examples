import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

interface Registered {
  type: string;
  name: string;
  inputs: Record<string, any>;
  dependsOn?: string[];
}

/**
 * Run the whole program under Pulumi mocks in a child process: `@di-framework/platform/local`
 * registers its resources at import, so every run needs a fresh module graph.
 */
function runStack(config: Record<string, unknown> = {}): {
  resources: Registered[];
  outputs: Record<string, any>;
} {
  const script = `
    const pulumi = require('@pulumi/pulumi');
    const project = 'platform-examples-meshtastic';
    const config = ${JSON.stringify(config)};
    pulumi.runtime.setAllConfig(Object.fromEntries(Object.entries({
      tenants: [{ name: 'meshtastic' }],
      users: [{ name: 'dev', memberships: [{ tenant: 'meshtastic', role: 'developer' }] }],
      egressAllowedDestinations: ['mqtt.meshtastic.org:1883'],
      tenantHostImage: '127.0.0.1:30500/di-framework/wash:2.8.0-wasi-tls',
      ...config,
    }).map(([key, value]) => [project + ':' + key, typeof value === 'string' ? value : JSON.stringify(value)])));
    const resources = [];
    const kubeconfig = 'apiVersion: v1\\nkind: Config\\n';
    pulumi.runtime.setMocks({
      newResource: (args) => {
        resources.push({ type: args.type, name: args.name, inputs: args.inputs });
        const state = { ...args.inputs };
        if (args.type === 'kubernetes:core/v1:Secret' && args.id)
          state.data = { token: Buffer.from('t').toString('base64'), 'ca.crt': Buffer.from('ca').toString('base64') };
        if (args.type === 'command:local:Command') state.stdout = args.name === 'kubeconfig' ? kubeconfig : '';
        state.metadata = { ...(args.inputs.metadata ?? {}), name: args.inputs.metadata?.name ?? args.name };
        return { id: args.id ?? args.name + '-id', state };
      },
      call: (args) => args.inputs,
    }, project, 'dev', false);
    pulumi.runtime.runInPulumiStack(async () => {
      const program = require('./src/program.ts').program;
      const result = await program();
      const outputs = {};
      for (const [key, value] of Object.entries(result)) {
        const output = pulumi.output(value);
        // Mocks leave the id of a Command with secret inputs unknown; skip those outputs.
        if (await output.isKnown) outputs[key] = await new Promise((resolve) => output.apply(resolve));
      }
      return outputs;
    }).then((outputs) => {
      process.stdout.write(JSON.stringify({ resources, outputs }));
    }).catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync('bun', ['-e', script], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) throw new Error(result.stderr || 'stack run failed');
  return JSON.parse(result.stdout);
}

// The repository-wide test run doesn't install this project's dependencies.
const installed = existsSync(join(root, 'node_modules', '@di-framework', 'platform'));
const { resources, outputs } = installed
  ? runStack({ containerCli: 'podman' })
  : { resources: [] as Registered[], outputs: {} as Record<string, any> };
const stackTest = test.skipIf(!installed);
const byName = (name: string) => resources.find((r) => r.name === name);
/** Mocks see secret inputs in their wire form. */
const SECRET_SIG = '4dabf18193072939515e22adb298388d';
const reveal = (value: any) => (value?.[SECRET_SIG] ? value.value : value);

stackTest('declares tenant meshtastic and user dev on the local platform', () => {
  const tenant = resources.find((r) => r.type.endsWith(':Tenant'));
  expect(tenant?.inputs.metadata.name).toBe('meshtastic');
  const user = resources.find((r) => r.type.endsWith(':User'));
  expect(user?.inputs.metadata.name).toBe('dev');
  expect(user?.inputs.spec.memberships).toEqual([{ tenant: 'meshtastic', role: 'developer' }]);
});

stackTest('runs every container command through the configured CLI', () => {
  const k0s = byName('k0s');
  expect(k0s?.inputs.create).toContain('podman run -d');
  const commands = resources.filter((r) => r.type === 'command:local:Command');
  expect(commands.some((r) => /(^|[;\s])docker\s/.test(String(r.inputs.create)))).toBe(false);
  expect(byName('tenant-host-image')?.inputs.create).toContain('podman push --tls-verify=false');
});

stackTest('approves the collector egress and uses the wasi-tls host image', () => {
  const egress = resources.find(
    (r) => r.type.endsWith(':BackingServiceClass') && r.inputs.spec?.type === 'egress',
  );
  expect(egress?.inputs.spec.egress.allowedDestinations).toEqual(['mqtt.meshtastic.org:1883']);
  const controller = byName('deployment-di-platform-controller');
  const cfg = JSON.parse(controller?.inputs.spec.template.spec.containers[0].env[0].value);
  expect(cfg.hostImage).toBe('127.0.0.1:30500/di-framework/wash:2.8.0-wasi-tls');
});

stackTest('deploys both services with the tenant kubeconfig after the platform is ready', () => {
  for (const service of ['mesh-collector', 'mesh-site']) {
    const deploy = byName(`deploy-${service}`);
    expect(deploy?.inputs.create).toBe(`di-framework platform deploy ${service}`);
    expect(deploy?.inputs.update).toBe(`di-framework platform deploy ${service}`);
    expect(deploy?.inputs.delete).toBe(`di-framework platform destroy ${service} || true`);
    expect(deploy?.inputs.dir).toBe(join(root, '..'));
    expect(deploy?.inputs.environment.KUBECONFIG).toBe(
      join(root, '.tenant-meshtastic-dev.kubeconfig'),
    );
    expect(deploy?.inputs.environment.SOURCE_HASH).toMatch(/^[0-9a-f]{64}$/);
  }
  const file = byName('tenant-kubeconfig');
  expect(reveal(file?.inputs.environment).KUBECONFIG_FILE).toBe(
    join(root, '.tenant-meshtastic-dev.kubeconfig'),
  );
  expect(reveal(reveal(file?.inputs.environment).KUBECONFIG_CONTENT)).toContain(
    'namespace: "di-tenant-meshtastic"',
  );
});

stackTest('creates the shared blobstore as the tenant before deploying', () => {
  const service = resources.find((r) => r.type.endsWith(':BackingService'));
  expect(service?.inputs.metadata).toMatchObject({
    name: 'mesh-objects',
    namespace: 'di-tenant-meshtastic',
  });
  expect(service?.inputs.spec).toEqual({
    type: 'blobstore',
    deletionPolicy: 'Delete',
    parameters: { memory: '512Mi' },
  });
  const binding = resources.find((r) => r.type.endsWith(':ServiceBinding'));
  expect(binding?.inputs.spec).toEqual({
    serviceName: 'mesh-objects',
    bindingName: 'objects',
    capability: 'blobstore',
    workloadName: 'mesh',
  });
  expect(binding?.inputs.metadata.annotations).toEqual({ 'pulumi.com/waitFor': 'condition=Ready' });
});

stackTest('exports the mesh-site URL and the console command', () => {
  expect(outputs.meshSiteUrl).toBe('http://mesh-site.meshtastic.localhost:28180/');
  expect(outputs.console).toBe(
    `cd ${join(root, '..')} && KUBECONFIG=${join(root, '.tenant-meshtastic-dev.kubeconfig')} di-framework platform console`,
  );
  expect(outputs.tenantKubeconfig).toBe(join(root, '.tenant-meshtastic-dev.kubeconfig'));
});
