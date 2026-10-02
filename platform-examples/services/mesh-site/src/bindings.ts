import { Blobstore, WasmCloudBinding } from '@di-framework/bindings';
import { useContainer } from '@di-framework/core/container';
import { Container } from '@di-framework/core/decorators';
import {
  ExportService,
  ServiceBinding,
  ServiceBindingRuntime,
} from '@di-framework/core/service-bindings';
import { type CatalogSnapshot, readBlobCatalog } from './catalog';

/** Unnamed host blobstore. mesh-collector writes the container `mesh`. */
@WasmCloudBinding('objects')
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
