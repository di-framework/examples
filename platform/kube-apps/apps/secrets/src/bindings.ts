import { Secrets, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('app-secrets', { secretFrom: 'binding-secrets' })
@Container()
export class AppSecrets extends Secrets {}
