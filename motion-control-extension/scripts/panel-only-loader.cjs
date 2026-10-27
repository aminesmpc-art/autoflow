const path = require('path');
const ts = require(path.resolve(__dirname, '../../studio-extension/node_modules/typescript'));

// Adapt only the standalone build, without changing shared Studio source.
module.exports = function panelOnly(source) {
  const file = ts.createSourceFile(this.resourcePath, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const background = this.resourcePath.replace(/\\/g, '/').endsWith('/background/service-worker.ts');
  function visit(node) {
    if (background && ts.isIfStatement(node) && node.expression.getText(file) === "typeof msg?.type === 'string'") {
      edits.push([node.expression.getStart(file), node.expression.end,
        "typeof msg?.type === 'string' && !msg.type.startsWith('MOTION_SOCIAL_')"]);
    }
    if (background && ts.isFunctionDeclaration(node) && node.name?.text === 'openStudio') {
      edits.push([node.getStart(file), node.end,
        `async function openStudio(): Promise<void> { console.warn('AutoFlow Motion runs in the side panel. Open it from the extension toolbar.'); }`]);
    }
    if (!background && ts.isVariableDeclaration(node) && node.name.getText(file) === 'injectStudioButton') {
      edits.push([node.initializer.getStart(file), node.initializer.end, '() => {}']);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const expected = background ? 2 : 1;
  if (edits.length !== expected) throw new Error(`Panel-only build: expected one launch hook${background ? ' and one message guard' : ''} in ${this.resourcePath}, found ${edits.length}. Review the shared adapter before shipping.`);
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + replacement + source.slice(end);
  return source;
};
