import { Blobstore, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('objects', { configFrom: 'binding-blobstore' })
@Container()
export class Objects extends Blobstore {}
