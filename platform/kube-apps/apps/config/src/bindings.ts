import { Config, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('app-config', {
  config: { message: 'inline', inlineOnly: 'inline-value' },
  configFrom: 'binding-config',
})
@Container()
export class AppConfig extends Config {}
