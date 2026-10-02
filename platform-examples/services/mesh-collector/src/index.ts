import { WorkloadService } from '@di-framework/bindings';
import { runCollector } from './session';

/** Long-lived collector. The host keeps this process up for the life of the application. */
export const collect = WorkloadService({ path: '/collect' })(
  async function collect(): Promise<void> {
    await runCollector();
  },
);
