const { spawn } = require('child_process');

function addEnv(name, value) {
  return new Promise((resolve) => {
    const child = spawn('npx.cmd', ['vercel', 'env', 'add', name, 'production'], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true
    });
    child.stdin.write(value);
    child.stdin.end();
    child.on('close', resolve);
  });
}

async function main() {
  await addEnv('NEXT_PUBLIC_API_URL', 'https://api.auto-flow.studio/api');
  await addEnv('NEXT_PUBLIC_EXTRACTOR_API_URL', 'https://autoflow-extractor-production.up.railway.app/api/videos');
}
main();
