import { Blobstore, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

/** Unnamed host blobstore. Both mesh members use the container `mesh`. */
@WasmCloudBinding('objects')
@Container()
export class MeshObjects extends Blobstore {}
