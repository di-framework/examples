/**
 * One-command deploy of the Meshtastic example: a local k0s platform with tenant
 * `meshtastic`, a wasi-tls tenant host, and mesh-collector + mesh-site deployed through
 * the di-framework CLI.
 */
import * as path from 'node:path';
import * as command from '@pulumi/command';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import {
  consoleCommand,
  hostImageCommand,
  OBJECTS_BINDING,
  OBJECTS_SERVICE,
  routeUrl,
  SERVICES,
  SITE_HOST,
  sourceHash,
  TENANT,
  USER,
  WORKLOAD,
} from './meshtastic';

const TENANT_TYPE = 'kubernetes:platform.di-framework.dev/v1alpha1:Tenant';
const LOCAL_HOST_IMAGE = 'localhost/di-framework/wash:2.8.0-wasi-tls';

export async function program() {
  const config = new pulumi.Config();
  const containerCli = config.get('containerCli') ?? 'docker';
  const registryPort = config.getNumber('registryPort') ?? 25000;
  const examples = path.resolve(__dirname, '..', '..');
  const hostContext = path.join(__dirname, '..', 'tenant-host');
  const tenantKubeconfig = path.join(__dirname, '..', `.tenant-${TENANT}-${USER}.kubeconfig`);

  // The stock wash host has no wasi:tls, which mesh-collector imports. Build one that
  // does and push it to the cluster registry the tenant host pulls from.
  const hostImage = new command.local.Command('tenant-host-image', {
    create: hostImageCommand({
      containerCli,
      context: hostContext,
      localImage: LOCAL_HOST_IMAGE,
      pushImage: `127.0.0.1:${registryPort}/di-framework/wash:2.8.0-wasi-tls`,
      registry: `http://127.0.0.1:${registryPort}`,
    }),
    environment: { SOURCE_HASH: sourceHash([hostContext]) },
  });

  // The Tenant waits for its host to be ready, so the host image must be in the
  // registry first. Everything else in the platform starts in parallel with the build.
  pulumi.runtime.registerResourceTransform(({ type, props, opts }) =>
    type === TENANT_TYPE
      ? { props, opts: pulumi.mergeOptions(opts, { dependsOn: [hostImage] }) }
      : undefined,
  );
  const platform = await import('@di-framework/platform/local');

  const kubeconfigContent = pulumi.secret(
    pulumi.output(platform.kubeconfigs).apply((all) => {
      const value = all?.[TENANT]?.[USER];
      if (!value) throw new Error(`The platform did not output a kubeconfig for ${TENANT}/${USER}`);
      return value;
    }),
  );
  const kubeconfigFile = new command.local.Command('tenant-kubeconfig', {
    create: 'umask 077; printf "%s\\n" "$KUBECONFIG_CONTENT" > "$KUBECONFIG_FILE"',
    update: 'umask 077; printf "%s\\n" "$KUBECONFIG_CONTENT" > "$KUBECONFIG_FILE"',
    delete: 'rm -f -- "$KUBECONFIG_FILE"',
    environment: { KUBECONFIG_CONTENT: kubeconfigContent, KUBECONFIG_FILE: tenantKubeconfig },
    logging: command.types.enums.local.Logging.None,
  });

  // The members share objects through one blobstore service. Both select its binding
  // projection (`di-binding-objects`) with configFrom; an unconfigured host blobstore is a
  // separate in-memory store per component.
  const tenant = new k8s.Provider('tenant', {
    kubeconfig: kubeconfigContent,
    namespace: `di-tenant-${TENANT}`,
  });
  const ready = { 'pulumi.com/waitFor': 'condition=Ready' };
  const objects = new k8s.apiextensions.CustomResource(
    'mesh-objects',
    {
      apiVersion: 'platform.di-framework.dev/v1alpha1',
      kind: 'BackingService',
      metadata: { name: OBJECTS_SERVICE, namespace: `di-tenant-${TENANT}`, annotations: ready },
      // The collector rewrites its objects every few seconds; the class default of 128Mi
      // gets the NATS server OOM-killed under that churn.
      spec: { type: 'blobstore', deletionPolicy: 'Delete', parameters: { memory: '512Mi' } },
    },
    { provider: tenant },
  );
  const objectsBinding = new k8s.apiextensions.CustomResource(
    'mesh-objects-binding',
    {
      apiVersion: 'platform.di-framework.dev/v1alpha1',
      kind: 'ServiceBinding',
      metadata: { name: OBJECTS_BINDING, namespace: `di-tenant-${TENANT}`, annotations: ready },
      // workloadName ties the binding to the `mesh` application in the console.
      spec: {
        serviceName: OBJECTS_SERVICE,
        bindingName: OBJECTS_BINDING,
        capability: 'blobstore',
        workloadName: WORKLOAD,
      },
    },
    { provider: tenant, dependsOn: [objects] },
  );

  const dependencies = new command.local.Command('example-dependencies', {
    create: 'bun install --frozen-lockfile',
    update: 'bun install --frozen-lockfile',
    dir: examples,
    environment: {
      SOURCE_HASH: sourceHash(
        ['package.json', 'bun.lock', ...SERVICES.map((s) => `services/${s}/package.json`)].map(
          (file) => path.join(examples, file),
        ),
      ),
    },
  });

  const manifest = path.join(examples, 'di-framework.deploy.toml');
  const deployments = SERVICES.map(
    (service) =>
      new command.local.Command(
        `deploy-${service}`,
        {
          create: `di-framework platform deploy ${service}`,
          update: `di-framework platform deploy ${service}`,
          // The cluster is removed right after; never block destroy on the app.
          delete: `di-framework platform destroy ${service} || true`,
          dir: examples,
          environment: {
            KUBECONFIG: tenantKubeconfig,
            SOURCE_HASH: sourceHash([path.join(examples, 'services', service), manifest]),
          },
        },
        { dependsOn: [kubeconfigFile, dependencies, hostImage, objectsBinding] },
      ),
  );

  return {
    meshSiteUrl: pulumi
      .all([platform.routeUrlPattern, ...deployments.map((d) => d.stdout)])
      .apply(([pattern]) => routeUrl(pattern as string, SITE_HOST, TENANT)),
    console: consoleCommand(examples, tenantKubeconfig),
    tenantKubeconfig,
    kubeconfig: platform.kubeconfig,
    endpoints: platform.endpoints,
    registry: platform.registry,
    tenants: platform.tenants,
  };
}
