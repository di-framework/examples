import { HttpRouter } from '@di-framework/http';
import assets from './assets';
import { siteHandler } from './bindings';

const router = HttpRouter.builder()
  .static('/assets', {
    directory: 'public',
    package: assets,
    live: false,
    cacheControl: 'no-cache',
  })
  .build();

router.get(
  '/',
  () => new Response(null, { status: 302, headers: { location: '/assets/index.html' } }),
);
router.get('/api/catalog', () => siteHandler().response());
router.all('*', () => Response.json({ error: 'Not found' }, { status: 404 }));

export async function handle(request: Request): Promise<Response> {
  const response = await router.fetch(request);
  return response ?? Response.json({ error: 'Not found' }, { status: 404 });
}
