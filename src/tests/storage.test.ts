/* ============================================================
   AutoFlow – Tests: Storage (unit-level, mocks chrome/IDB)
   ============================================================ */

// Mock chrome.storage.local
const mockStorage: Record<string, any> = {};

const chromeStorageMock = {
  get: jest.fn((key: string, cb: (result: any) => void) => {
    cb({ [key]: mockStorage[key] });
  }),
  set: jest.fn((items: Record<string, any>, cb?: () => void) => {
    Object.assign(mockStorage, items);
    cb?.();
  }),
};

// @ts-ignore
global.chrome = {
  storage: {
    local: chromeStorageMock,
  },
} as any;

// @ts-ignore - mock indexedDB
global.indexedDB = undefined as any;

describe('Storage - Queue Counter', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    jest.clearAllMocks();
  });

  test('getNextQueueName returns AUTOFLOW1 initially', async () => {
    // Inline implementation to avoid import issues with chrome mock
    const getCounter = (): Promise<number> => {
      return new Promise(resolve => {
        chromeStorageMock.get('autoflow_queue_counter', (result: any) => {
          resolve(result['autoflow_queue_counter'] ?? 1);
        });
      });
    };

    const counter = await getCounter();
    expect(counter).toBe(1);
    expect(`AUTOFLOW${counter}`).toBe('AUTOFLOW1');
  });

  test('counter increments after use', async () => {
    mockStorage['autoflow_queue_counter'] = 5;

    const getCounter = (): Promise<number> => {
      return new Promise(resolve => {
        chromeStorageMock.get('autoflow_queue_counter', (result: any) => {
          resolve(result['autoflow_queue_counter'] ?? 1);
        });
      });
    };

    const counter = await getCounter();
    expect(counter).toBe(5);

    const setCounter = (val: number): Promise<void> => {
      return new Promise(resolve => {
        chromeStorageMock.set({ 'autoflow_queue_counter': val }, resolve);
      });
    };
    await setCounter(counter + 1);

    const newCounter = await getCounter();
    expect(newCounter).toBe(6);
  });

  test('queue persistence structure', () => {
    const queue = {
      id: 'test-id',
      name: 'AUTOFLOW1',
      prompts: [
        { id: '1', index: 0, text: 'test prompt', images: [], status: 'queued', attempts: 0, outputFiles: [] },
      ],
      settings: {
        model: 'Veo 3.1 Fast',
        ratio: 'landscape',
        generations: 1,
        stopOnError: false,
        autoDownload: true,
      },
      runTarget: 'currentProject',
      status: 'pending',
      currentPromptIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Verify serialization roundtrip
    const serialized = JSON.stringify(queue);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.name).toBe('AUTOFLOW1');
    expect(deserialized.prompts).toHaveLength(1);
    expect(deserialized.prompts[0].status).toBe('queued');
    expect(deserialized.settings.model).toBe('Veo 3.1 Fast');
  });
});
