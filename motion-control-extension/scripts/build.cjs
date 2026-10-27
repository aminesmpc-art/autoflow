const path = require('path');
/* --test: the build with the Motion subscription check off (npm run build:test).
   Set here and never inherited, so a plain build is always the real one. Must
   come before the config is required — it reads the flag once. */
const test = process.argv.includes('--test');
if (test) process.env.MOTION_TEST_BUILD = '1';
else delete process.env.MOTION_TEST_BUILD;
const webpack = require('../../studio-extension/node_modules/webpack');
const config = require('../webpack.config.cjs');

webpack(config, (error, stats) => {
  if (error) { console.error(error); process.exitCode = 1; return; }
  console.log(stats.toString({ colors: false, chunks: false, modules: false }));
  if (stats.hasErrors()) process.exitCode = 1;
  else {
    console.log(`Load unpacked: ${path.resolve(__dirname, '../dist')}`);
    if (test) console.log('TEST BUILD: the Motion subscription check is OFF. For local testing only; package:store refuses it. Run npm run build before packaging.');
  }
});
