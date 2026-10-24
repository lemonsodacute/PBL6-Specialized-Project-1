const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd(), visited = new Set(), external = new Set();
function resolve(from, name) {
  if (!name.startsWith('.') && !name.startsWith('@/')) { external.add(name); return; }
  const target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(from), name);
  return ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map(suffix => target+suffix).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
function visit(file) {
  if (visited.has(file) || !/\.tsx?$/.test(file)) return;
  visited.add(file);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const node of source.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || node.isTypeOnly || node.importClause?.isTypeOnly) continue;
    const clause = node.importClause;
    if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(item => item.isTypeOnly)) continue;
    const target = resolve(file, node.moduleSpecifier.text);
    if (target) visit(target);
  }
}
function layouts(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) layouts(file); else if (entry.name === 'layout.tsx') visit(file);
  }
}
layouts(path.join(root, 'app'));
const heavy = [...external].filter(name => /livekit|mammoth|pdfjs|tesseract|onnx|generative-ai|google.genai|recharts|chart.js/i.test(name));
const result = { layout_static_import_files: visited.size, external: [...external].sort(), heavy_packages: heavy,
  method: 'Conservative static graph; type-only imports excluded, barrel exports included. Dynamic route imports are not shared imports.' };
fs.writeFileSync('artifacts/performance/layout-imports.json', JSON.stringify(result,null,2));
console.info(JSON.stringify(result));
