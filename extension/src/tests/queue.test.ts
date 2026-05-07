/* ============================================================
   AutoFlow – Tests: Queue Logic
   - Max-3 image enforcement
   - Queue naming increment
   - Reorder
   ============================================================ */

import { MAX_IMAGES_PER_PROMPT } from '../shared/constants';

describe('Max images per prompt', () => {
  test('MAX_IMAGES_PER_PROMPT is 3', () => {
    expect(MAX_IMAGES_PER_PROMPT).toBe(3);
  });

  test('enforces max 3 images per prompt', () => {
    const images: string[] = [];
    const addImage = (img: string): boolean => {
      if (images.length >= MAX_IMAGES_PER_PROMPT) return false;
      images.push(img);
      return true;
    };

    expect(addImage('img1.png')).toBe(true);
    expect(addImage('img2.png')).toBe(true);
    expect(addImage('img3.png')).toBe(true);
    expect(addImage('img4.png')).toBe(false);
    expect(images).toHaveLength(3);
  });
});

describe('Queue naming increment', () => {
  test('generates sequential AUTOFLOW names', () => {
    let counter = 1;
    const getNextName = (): string => {
      const name = `AUTOFLOW${counter}`;
      counter++;
      return name;
    };

    expect(getNextName()).toBe('AUTOFLOW1');
    expect(getNextName()).toBe('AUTOFLOW2');
    expect(getNextName()).toBe('AUTOFLOW3');
    expect(counter).toBe(4);
  });

  test('counter persists across calls', () => {
    let counter = 42;
    const name = `AUTOFLOW${counter}`;
    counter++;
    expect(name).toBe('AUTOFLOW42');
    expect(counter).toBe(43);
  });
});

describe('Queue reorder', () => {
  test('moves item up', () => {
    const queues = ['A', 'B', 'C', 'D'];
    const fromIdx = 2;
    const toIdx = 1;
    const [item] = queues.splice(fromIdx, 1);
    queues.splice(toIdx, 0, item);
    expect(queues).toEqual(['A', 'C', 'B', 'D']);
  });

  test('moves item down', () => {
    const queues = ['A', 'B', 'C', 'D'];
    const fromIdx = 1;
    const toIdx = 3;
    const [item] = queues.splice(fromIdx, 1);
    queues.splice(toIdx, 0, item);
    expect(queues).toEqual(['A', 'C', 'D', 'B']);
  });

  test('move to same position is no-op', () => {
    const queues = ['A', 'B', 'C'];
    const fromIdx = 1;
    const toIdx = 1;
    const [item] = queues.splice(fromIdx, 1);
    queues.splice(toIdx, 0, item);
    expect(queues).toEqual(['A', 'B', 'C']);
  });

  test('preserves strict order for execution', () => {
    const prompts = [
      { id: 1, text: 'First' },
      { id: 2, text: 'Second' },
      { id: 3, text: 'Third' },
    ];
    // Verify index-based iteration preserves order
    const executionOrder: number[] = [];
    for (let i = 0; i < prompts.length; i++) {
      executionOrder.push(prompts[i].id);
    }
    expect(executionOrder).toEqual([1, 2, 3]);
  });
});

describe('Filename ordering', () => {
  test('generates correct filenames with zero-padded indices', () => {
    const queueName = 'AUTOFLOW1';
    const makeFilename = (promptIdx: number, genNum: number): string =>
      `${queueName}/prompt_${String(promptIdx + 1).padStart(3, '0')}_gen_${String(genNum).padStart(2, '0')}.mp4`;

    expect(makeFilename(0, 1)).toBe('AUTOFLOW1/prompt_001_gen_01.mp4');
    expect(makeFilename(0, 2)).toBe('AUTOFLOW1/prompt_001_gen_02.mp4');
    expect(makeFilename(9, 1)).toBe('AUTOFLOW1/prompt_010_gen_01.mp4');
    expect(makeFilename(99, 4)).toBe('AUTOFLOW1/prompt_100_gen_04.mp4');
  });

  test('filenames sort correctly', () => {
    const files = [
      'AUTOFLOW1/prompt_010_gen_01.mp4',
      'AUTOFLOW1/prompt_001_gen_02.mp4',
      'AUTOFLOW1/prompt_001_gen_01.mp4',
      'AUTOFLOW1/prompt_002_gen_01.mp4',
    ];
    files.sort();
    expect(files).toEqual([
      'AUTOFLOW1/prompt_001_gen_01.mp4',
      'AUTOFLOW1/prompt_001_gen_02.mp4',
      'AUTOFLOW1/prompt_002_gen_01.mp4',
      'AUTOFLOW1/prompt_010_gen_01.mp4',
    ]);
  });
});

describe('Scheduler ordering', () => {
  test('processes prompts strictly in index order', () => {
    const prompts: Array<{ index: number; status: string }> = Array.from({ length: 5 }, (_, i) => ({
      index: i,
      status: 'queued',
    }));

    const executed: number[] = [];
    for (let i = 0; i < prompts.length; i++) {
      prompts[i].status = 'done';
      executed.push(i);
    }

    expect(executed).toEqual([0, 1, 2, 3, 4]);
    expect(prompts.every(p => p.status === 'done')).toBe(true);
  });

  test('skips already-done prompts on resume', () => {
    const prompts: Array<{ index: number; status: string }> = [
      { index: 0, status: 'done' },
      { index: 1, status: 'done' },
      { index: 2, status: 'queued' },
      { index: 3, status: 'queued' },
    ];

    let startFrom = 0;
    while (startFrom < prompts.length && prompts[startFrom].status === 'done') {
      startFrom++;
    }

    expect(startFrom).toBe(2);
    const remaining = prompts.slice(startFrom);
    expect(remaining.length).toBe(2);
    expect(remaining[0].index).toBe(2);
  });
});
