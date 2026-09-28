import { KeyValue, Postgres, WasmCloudBinding } from '@di-framework/bindings';
import { Container } from '@di-framework/core/decorators';

@WasmCloudBinding('user-database')
@Container()
export class UserDatabase extends Postgres {}

@WasmCloudBinding('sessions', { interfaces: ['store', 'atomics'] })
@Container()
export class Sessions extends KeyValue {}

@WasmCloudBinding('cache')
@Container()
export class Cache extends KeyValue {}
