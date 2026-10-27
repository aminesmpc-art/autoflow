const path = require('path');
const shared = path.resolve(__dirname, '../studio-extension');
const deps = path.join(shared, 'node_modules');
const CopyPlugin = require(path.join(deps, 'copy-webpack-plugin'));
const MiniCssExtractPlugin = require(path.join(deps, 'mini-css-extract-plugin'));
const { DefinePlugin } = require(path.join(deps, 'webpack'));
/* `npm run build:test` only — scripts/build.cjs sets this, and clears it for a
   plain build. The Motion subscription check is off, for testing while billing
   is not deployed, and the build is renamed so it cannot pass for the real one:
   Chrome shows the name, and package-store.ps1 refuses it. */
const testBuild = process.env.MOTION_TEST_BUILD === '1';
const TEST_NAME = 'AutoFlow Motion — TEST BUILD';
const testManifest = (content) => {
  const manifest = JSON.parse(content.toString());
  manifest.name = TEST_NAME;
  manifest.description = 'TEST BUILD: the Motion subscription check is off. Never upload this build to the Chrome Web Store.';
  manifest.action = { ...manifest.action, default_title: TEST_NAME };
  return JSON.stringify(manifest, null, 2);
};
const entries = {
  'flow-content': 'content/flow/index.ts',
  'chatgpt-content': 'content/chatgpt/index.ts',
  'gemini-content': 'content/gemini/index.ts',
  'gemini-network': 'content/gemini/networkHook.ts',
  'claude-content': 'content/claude/index.ts',
  'sw-bypass': 'content/flow/sw-bypass.ts',
  /* No offscreen document: only Studio's background opens one, and Motion's
     never did, so the permission it needed was requested and never used —
     which the Chrome Web Store rejects. */
};
module.exports = {
  mode: 'production', context: __dirname,
  entry: {
    ...Object.fromEntries(Object.entries(entries).map(([key, file]) => [key, path.join(shared, 'src', file)])),
    background: './src/background.ts',
    'social-content': './src/social/content.ts',
    motion: './src/index.tsx',
  },
  output: { path: path.resolve(__dirname, 'dist'), filename: '[name].js', clean: true },
  resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [deps, 'node_modules'] },
  resolveLoader: { modules: [deps, 'node_modules'] },
  module: { rules: [
    { include: [path.join(shared, 'src/background/service-worker.ts'), path.join(shared, 'src/content/flow/index.ts')], enforce: 'pre', use: [path.resolve(__dirname, 'scripts/panel-only-loader.cjs')] },
    { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { configFile: path.resolve(__dirname, 'tsconfig.json'), onlyCompileBundledFiles: true } }] },
    { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
  ] },
  plugins: [new DefinePlugin({ __AUTOFLOW_MOTION__: JSON.stringify(true), __MOTION_BILLING_CHECK__: JSON.stringify(!testBuild) }), new MiniCssExtractPlugin({ filename: '[name].css' }), new CopyPlugin({ patterns: [
    testBuild ? { from: 'manifest.json', transform: testManifest } : { from: 'manifest.json' }, { from: 'sidepanel.html' }, { from: 'privacy.html' },
    /* Motion's own icons (npm run icons), not Studio's — installed side by side
       the two were indistinguishable in the toolbar. The SVG master stays out. */
    { from: 'icons', to: 'icons', globOptions: { ignore: ['**/source/**'] } },
  ] })],
  devtool: false,
};
