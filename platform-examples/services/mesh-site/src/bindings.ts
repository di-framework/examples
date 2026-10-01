import { Blobstore, WasmCloudBinding } from '@di-framework/bindings';
import { useContainer } from '@di-framework/core/container';
import { Container } from '@di-framework/core/decorators';
import {
  ExportService,
  ServiceBinding,
  ServiceBindingRuntime,
} from '@di-framework/core/service-bindings';
import { type CatalogSnapshot, readBlobCatalog } from './catalog';

/**
 * Blobstore service `mesh-objects`, bound as `objects`. Both mesh members use the container
 * `mesh`; the platform projects the store's NATS URL into ConfigMap `di-binding-objects`.
 */
@WasmCloudBinding('objects', { configFrom: 'di-binding-objects' })
@Container()
export class MeshObjects extends Blobstore {}

export type CatalogApi = {
  snapshot(): Promise<CatalogSnapshot>;
};

ServiceBindingRuntime.current.configure({
  currentServiceId: 'mesh-site',
  bindings: { catalog: 'mesh-catalog' },
  grants: [
    {
      caller: 'mesh-site',
      target: 'mesh-catalog',
      allowedOperations: ['snapshot'],
    },
  ],
});

@Container()
@ExportService({ name: 'mesh-catalog', operations: ['snapshot'] })
export class MeshCatalog {
  async snapshot(): Promise<CatalogSnapshot> {
    return readBlobCatalog(useContainer().resolve(MeshObjects));
  }
}

@Container()
export class SiteHandler {
  constructor(
    @ServiceBinding('catalog', {
      caller: 'mesh-site',
      target: 'mesh-catalog',
      expectedOperations: ['snapshot'],
    })
    readonly catalog: CatalogApi,
  ) {}

  async response(): Promise<Response> {
    return Response.json(await this.catalog.snapshot());
  }
}

export function siteHandler(): SiteHandler {
  return useContainer().resolve(SiteHandler);
}
