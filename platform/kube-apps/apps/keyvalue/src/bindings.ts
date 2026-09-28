import { KeyValue, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('cache', { configFrom: 'binding-keyvalue' })
@Container()
export class Cache extends KeyValue {}
