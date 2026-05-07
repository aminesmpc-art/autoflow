const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'content': './src/content/index.ts',
    'sidepanel': './src/sidepanel/index.ts',
    'background': './src/background/service-worker.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'sidepanel.html', to: 'sidepanel.html' },
        { from: 'sidepanel.css', to: 'sidepanel.css' },
        { from: 'grok-theme.css', to: 'grok-theme.css' },
        { from: 'icons', to: 'icons', noErrorOnMissing: true },
      ],
    }),
  ],
};
