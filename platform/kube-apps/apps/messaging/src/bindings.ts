import { Messaging, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('broker')
@Container()
export class Broker extends Messaging {}
