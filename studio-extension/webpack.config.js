const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

/**
 * One entry per surface. `flow-content` is named for its platform rather than
 * the generic `content` the AutoFlow extension uses, because this extension
 * carries three engines and "content.js" would stop meaning anything.
 */
module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production' || process.env.NODE_ENV === 'production';

  return {
    entry: {
      background: './src/background/service-worker.ts',
    'studio-bridge': './src/content/web/index.ts',
      'flow-content': './src/content/flow/index.ts',
      'chatgpt-content': './src/content/chatgpt/index.ts',
      'gemini-content': './src/content/gemini/index.ts',
      'grok-content': './src/content/grok/index.ts',
      'claude-content': './src/content/claude/index.ts',
      'zai-content': './src/content/zai/index.ts',
      'sw-bypass': './src/content/flow/sw-bypass.ts',
      studio: './src/studio/index.tsx',
      sidepanel: './src/sidepanel/index.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                onlyCompileBundledFiles: true,
              },
            },
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            { loader: 'css-loader', options: { sourceMap: !isProduction } },
          ],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new CopyPlugin({
        patterns: [
          { from: 'manifest.json', to: '.' },
          { from: 'studio.html', to: '.' },
          { from: 'sidepanel.html', to: '.' },
          { from: 'icons', to: 'icons', noErrorOnMissing: true },
          { from: 'assets', to: 'assets', noErrorOnMissing: true },
        ],
      }),
    ],
    devtool: isProduction ? false : 'cheap-module-source-map',
  };
};
