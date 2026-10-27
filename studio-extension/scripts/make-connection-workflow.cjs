// Deterministic test artwork and workflow, written to stdout for export.
const zlib = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
function ballImage(cx) {
  const width = 640, height = 360;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = y < 230 ? [224, 232, 240] : [173, 185, 196];
    if (y > 230 && ((y - 230) % 32 === 0 || x % 80 === 0)) color = [150, 163, 176];
    if ((x - cx) ** 2 / 2500 + (y - 282) ** 2 / 144 < 1) color = [120, 132, 144];
    if ((x - cx) ** 2 + (y - 241) ** 2 < 1600) color = [221, 52, 56];
    if ((x - cx + 12) ** 2 + (y - 226) ** 2 < 100) color = [246, 130, 126];
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    pixels.set(color, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
const node = (id, type, x, y, data) => ({ id, type, position: { x, y }, data: { type, ...data } });
const clip = (id, x, label) => node(id, 'generate', x, 220, {
  label, platform: 'flow', mediaType: 'video', model: 'Veo 3.1 - Fast', creationType: 'frames',
  aspectRatio: '16:9', duration: '8s', enabled: true, status: 'idle', progress: 0,
});
const prompt = (id, x, text) => node(id, 'prompt', x, 0, { label: id, text });
const edge = (source, target, sourceHandle, targetHandle) => ({
  id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle,
  type: 'deletable', animated: true,
});
const common = 'One continuous locked-off wide shot, landscape 16:9. A single red ball on the grey tiled floor against the pale blue-grey wall. Keep the same ball, grid, lighting, scale and static camera. No people, text, cuts or camera motion. ';
const nodes = [
  node('start_image', 'image', 0, 220, { label: 'START IMAGE - included', imageName: 'test-ball-left.png', imageData: ballImage(160) }),
  prompt('prompt_1', 380, common + 'Begin exactly on the provided start frame. The ball rolls slowly from the left toward the centre, then comes to rest.'),
  clip('clip_1', 380, 'TEST 1 - Image to Start'),
  node('last_frame', 'frame', 800, 220, { label: 'TEST 2 - Captured last frame' }),
  node('end_image', 'image', 800, 650, { label: 'END IMAGE - included', imageName: 'test-ball-right.png', imageData: ballImage(480) }),
  prompt('prompt_2', 1180, common + 'Begin exactly where the previous clip ended. The ball rolls smoothly to the right, ending exactly on the provided end frame.'),
  clip('clip_2', 1180, 'TEST 3 - Start and End'),
  prompt('prompt_3', 1640, common + 'Continue from the provided start frame without a jump. The ball pauses briefly on the right, then rolls gently back toward the centre.'),
  clip('clip_3', 1640, 'TEST 4 - Direct video chain'),
];
const edges = [
  edge('prompt_1', 'clip_1', 'text', 'text'), edge('start_image', 'clip_1', 'image', 'frame_start'),
  edge('clip_1', 'last_frame', 'result', 'image_ref'),
  edge('prompt_2', 'clip_2', 'text', 'text'), edge('last_frame', 'clip_2', 'image', 'frame_start'),
  edge('end_image', 'clip_2', 'image', 'frame_end'),
  edge('prompt_3', 'clip_3', 'text', 'text'), edge('clip_2', 'clip_3', 'result', 'frame_start'),
];
process.stdout.write(JSON.stringify({ autoflowStudio: 1, id: 'studio-connection-regression',
  name: 'Studio Connection Test - 3 clips', description: 'Included test images. Tests image-to-Start, captured last frame, Start/End ordering and direct video chaining. Run submits three provider generations; importing does not run anything.',
  useCase: 'Connection regression test', category: 'Testing', difficulty: 'Easy', nodeCount: nodes.length, nodes, edges,
}, null, 2));
