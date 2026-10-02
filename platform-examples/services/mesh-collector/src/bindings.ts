import { Blobstore, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

/**
 * Blobstore service `mesh-objects`, bound as `objects`. Both mesh members use the container
 * `mesh`; the platform projects the store's NATS URL into ConfigMap `di-binding-objects`.
 */
@WasmCloudBinding('objects', { configFrom: 'di-binding-objects' })
@Container()
export class MeshObjects extends Blobstore {}
