const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpack = require('webpack');

/** Sixteen hex characters of SHA-256. Enough to notice a change. */
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/**
 * Write down which sources this bundle was built from, and their hashes.
 *
 * Read back by src/tests/webBundle.test.ts, which fails when a source has
 * moved since — the one thing that turns "committed build artifact" from a
 * quiet liability into a checked one. Only files under src/ are recorded:
 * a mediabunny upgrade is a package-lock change and has its own review.
 */
class StampSources {
  constructor(outFile) { this.outFile = outFile; }

  apply(compiler) {
    compiler.hooks.done.tap('StampSources', (stats) => {
      const root = compiler.context;
      const files = Array.from(stats.compilation.fileDependencies)
        /* fileDependencies carries the watched DIRECTORIES too, and reading
           one of those is an EISDIR that fails the build after it succeeded. */
        .filter((f) => f.startsWith(path.join(root, 'src'))
          && fs.existsSync(f) && fs.statSync(f).isFile())
        .map((f) => path.relative(root, f).split(path.sep).join('/'))
        .sort();

      const entries = {};
      for (const rel of files) entries[rel] = sha(fs.readFileSync(path.join(root, rel)));

      fs.writeFileSync(this.outFile, `${JSON.stringify({
        _comment:
          'Written by webpack.web.js. The sources website/src/vendor/autoflow-clip.js '
          + 'was built from. If a test says these have moved, run `npm run build:web` '
          + 'in studio-extension and commit the result.',
        builtAt: new Date().toISOString(),
        entry: 'src/web/clipWeb.ts',
        files: entries,
      }, null, 2)}\n`);
    });
  }
}

/**
 * The clipping pipeline, compiled for the website.
 *
 * Separate from webpack.config.js because it emits something that is not part
 * of the extension: one ESM module, written into the website's tree, holding
 * the clip and media code plus mediabunny. The site imports it like any other
 * module.
 *
 * ── Why a built file and not a shared source directory ────────────────────
 *
 * Vercel deploys the website from `website/`, and only `website/` is uploaded.
 * A build there cannot reach `../studio-extension` — so the choice was never
 * "import the source" against "commit a bundle", it was "commit a bundle"
 * against "keep a second copy of the pipeline in JavaScript". A bundle is a
 * build artifact in git, which is not lovely; two copies of the survey prompt
 * and the caption timing drifting apart is worse, and this repo has the
 * comments to prove it.
 *
 * The website does not need a TypeScript toolchain as a result, which is the
 * incidental benefit that decided it.
 *
 *   npm run build:web        (from studio-extension/)
 */
module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production' || process.env.NODE_ENV === 'production';

  return {
    entry: { 'autoflow-clip': './src/web/clipWeb.ts' },
    output: {
      path: path.resolve(__dirname, '..', 'website', 'src', 'vendor'),
      filename: '[name].js',
      /* One file. Webpack would happily emit the mediabunny chunk separately
         and load it at runtime, which works under its own dev server and not
         at all once Next has moved the assets somewhere else. */
      chunkFormat: 'module',
      module: true,
      library: { type: 'module' },
      /* NOT `clean`. This directory is inside someone else's project and a
         stray true here would delete whatever else lives there. */
      clean: false,
      environment: { module: true, dynamicImport: true },
    },
    experiments: { outputModule: true },
    /* The lazy imports inside the pipeline (clipMedia, readingApi) exist to
       keep a demuxer out of the extension's other surfaces. The website
       already loads this module lazily as a whole, so a second layer of
       splitting only produces chunks Next has to be taught to serve. */
    optimization: {
      splitChunks: false,
      minimize: isProduction,
      runtimeChunk: false,
    },
    plugins: [
      /* Fold the lazy imports back in.
         clipMedia and readingApi are loaded with import() so that the
         extension does not put a demuxer into surfaces that never clip
         anything. Webpack honours that here too and emits 344.js beside the
         entry — which Next then has to find, serve and hash, for a saving
         the website already made by loading this whole module lazily.
         One chunk means one import specifier for Next to resolve. */
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      new StampSources(
        path.resolve(__dirname, '..', 'website', 'src', 'vendor', 'autoflow-clip.sources.json'),
      ),
    ],
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: [{
            loader: 'ts-loader',
            options: {
              onlyCompileBundledFiles: true,
              /* The extension's tsconfig names chrome types this entry never
                 uses. Keeping them satisfies the shared modules' imports
                 without a second tsconfig to keep in step. */
              compilerOptions: { module: 'ESNext', declaration: false },
            },
          }],
          exclude: /node_modules/,
        },
      ],
    },
    target: 'web',
    devtool: isProduction ? false : 'source-map',
    performance: {
      /* A demuxer, an encoder and a caption renderer. It is a big module and
         saying so on every build is noise, not information. */
      hints: false,
    },
  };
};
