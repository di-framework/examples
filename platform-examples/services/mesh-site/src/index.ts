import { WorkloadComponent } from '@di-framework/bindings';
import { handle } from './router';

/** HTTP component for the mesh workload. Path `/` serves the whole host. */
export const fetch = WorkloadComponent({ path: '/' })(async function fetch(
  request: Request,
): Promise<Response> {
  return handle(request);
});
