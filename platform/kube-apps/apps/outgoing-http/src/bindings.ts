import { OutgoingHttp, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('http-client')
@Container()
export class HttpClient extends OutgoingHttp {}
