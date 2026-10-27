jest.mock('../../studio-extension/src/shared/product', () => ({ IS_MOTION: true }));
import { getApiBase, trackSubmission, trackUsage } from '../../studio-extension/src/shared/api';

test('Motion pins account origin and does not charge Studio usage endpoints', async () => {
  const get = jest.fn(async () => ({ autoflow_api_base: 'https://untrusted.test' }));
  (globalThis as any).chrome = { storage: { local: { get } } };
  expect(await getApiBase()).toBe('https://api.auto-flow.studio');
  expect(await trackUsage(1, 'text')).toBe(true);
  expect(await trackSubmission({ mediaId: 'media', queueId: 'queue', promptIndex: 0, promptType: 'text' })).toBe(true);
  expect(get).not.toHaveBeenCalled();
});
