/// <reference types="node" />

// Actual adapter execution with page timers held: only worker replies advance it.
const PROMPT = 'Describe the camera and every movement in the attached clip.';
const ANSWER = 'The subject walks forward and raises their right arm in a continuous medium shot.';
let sent: any[];
let handler: (message: any, sender: any, reply: (result: any) => void) => boolean;
let submissionCount: number;
let fileCount: number;
let workerPolls: number;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  sent = []; submissionCount = 0; fileCount = 0; workerPolls = 0;
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.body.innerHTML = '<div class="attachment-preview-wrapper"></div><rich-textarea>'
    + '<div class="ql-editor" role="textbox" contenteditable="true" data-placeholder="Ask Gemini"></div>'
    + '</rich-textarea><button class="send-button">Send</button>';
  class Transfer {
    files: File[] = [];
    items = { add: (file: File) => this.files.push(file) };
    text = '';
    setData(_type: string, text: string) { this.text = text; }
    getData() { return this.text; }
  }
  class Paste extends Event {
    clipboardData: Transfer;
    constructor(type: string, options: any) { super(type, options); this.clipboardData = options.clipboardData; }
  }
  (globalThis as any).DataTransfer = Transfer;
  (globalThis as any).ClipboardEvent = Paste;
  (globalThis as any).chrome = { runtime: {
    onMessage: { addListener: (fn: typeof handler) => { handler = fn; }, removeListener: () => {} },
    sendMessage: async (message: any) => {
      if (message.type === 'GEMINI_WAIT') {
        workerPolls++;
        // Upload completion happens without executing any page timer.
        if (workerPolls >= 3) document.querySelector('mat-spinner')?.remove();
        return { elapsed: true };
      }
      sent.push(message);
      return {};
    },
  } };
  const composer = document.querySelector('.ql-editor')!;
  composer.addEventListener('paste', ((event: Paste) => {
    if (event.clipboardData.files.length) {
      fileCount += event.clipboardData.files.length;
      document.querySelector('.attachment-preview-wrapper')!.innerHTML =
        '<uploader-file-preview><gem-media-attachment></gem-media-attachment><mat-spinner></mat-spinner></uploader-file-preview>';
    } else composer.textContent = event.clipboardData.getData();
  }) as EventListener);
  document.querySelector('button')!.addEventListener('click', () => {
    submissionCount++;
    expect(document.querySelector('mat-spinner')).toBeNull();
    expect(composer.textContent).toBe(PROMPT);
    composer.textContent = '';
    const response = document.createElement('model-response');
    response.innerHTML = `<message-content>${ANSWER}</message-content><message-actions><button aria-label="Copy"></button></message-actions>`;
    document.body.append(response);
  });
  require('../../studio-extension/src/content/gemini/index');
});

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); document.body.innerHTML = ''; });

async function execute(referenceImageData: string[] = []) {
  let acknowledged: any;
  handler({ type: 'STUDIO_EXECUTE_NODE', payload: {
    nodeId: 'hidden-gemini', config: { prompt: PROMPT, mediaType: 'text', rawReply: true,
      deleteWhenDone: false, referenceImageData },
  } }, {}, value => { acknowledged = value; });
  for (let i = 0; i < 100; i++) await Promise.resolve();
  expect(acknowledged).toEqual({ success: true });
  expect(submissionCount).toBe(1);
  expect(workerPolls).toBeGreaterThan(0);
  expect(sent.filter(message => message.type === 'STUDIO_NODE_ERROR')).toEqual([]);
  expect(sent.filter(message => message.type === 'STUDIO_NODE_RESULT')).toEqual([
    { type: 'STUDIO_NODE_RESULT', payload: expect.objectContaining({ nodeId: 'hidden-gemini', text: ANSWER }) },
  ]);
}

it('submits and collects text while hidden without a single page timer firing', async () => { await execute(); });
it('waits for a hidden attachment to finish and submits it exactly once', async () => {
  await execute(['data:video/mp4;base64,Y2xpcA==']);
  expect(fileCount).toBe(1);
});
