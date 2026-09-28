import { Config, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('app-config')
@Container()
export class AppConfig extends Config {}
