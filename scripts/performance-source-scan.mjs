import { Scanner } from '@tailwindcss/oxide';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
const bounded = process.argv.includes('--bounded');
const started = performance.now();
const sources = (bounded ? ['app', 'components', 'lib'] : ['.']).map(directory => ({ base: path.resolve(directory), pattern: '**/*', negated: false }));
const scanner = new Scanner({ sources });
const candidates = scanner.scan();
const result = { bounded, elapsed_ms: Math.round((performance.now()-started)*100)/100, files: scanner.files.length, scanned_files: scanner.scannedFiles.length, candidates: candidates.length, roots: {} };
for (const file of scanner.files) { const root = path.relative(process.cwd(),file).split(/[\\/]/)[0]; result.roots[root]=(result.roots[root]||0)+1; }
fs.writeFileSync(`artifacts/performance/source-scan-${bounded ? 'bounded' : 'automatic'}.json`, JSON.stringify(result,null,2));
console.info(JSON.stringify(result));
