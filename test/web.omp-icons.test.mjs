// OMP marks in chrome and tiny scene screens, without browser/computer control.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'agentoffice-omp-icons-'));
after(() => {
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
  assert.ok(dir.includes('agentoffice-omp-icons-'));
  rmSync(dir, { recursive: true, force: true });
});
const outfile = join(dir, 'icons.mjs');
await build({ stdin: { contents: 'export * from "./web/ui/logos.ts";export * from "./web/scene/logos.ts";export * from "./web/scene/props.ts";export * from "./web/scene/palette.ts";', resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile, logLevel: 'error', loader: { '.svg': 'text' } });

class FakeNode {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(k, v) { this.attrs[k] = v; }
  cloneNode() { const clone = new FakeNode(this.tagName); clone.attrs = { ...this.attrs }; clone.markup = this.markup; return clone; }
}
class FakeTemplate extends FakeNode {
  set innerHTML(value) { this.content = new FakeNode('fragment'); this.content.markup = value; this.svg = new FakeNode('svg'); this.content.querySelector = () => this.svg; }
}
class FakeCanvas {
  constructor() { this.context = { imageSmoothingEnabled: false, fillStyle: '', fills: [], fillRect(x,y,w,h) { this.fills.push({x,y,w,h,color:this.fillStyle}); } }; }
  getContext() { return this.context; }
}
globalThis.document = { createElement: tag => tag === 'canvas' ? new FakeCanvas() : tag === 'template' ? new FakeTemplate(tag) : new FakeNode(tag) };
const { logo, pixelLogo, drawScreen, BRAND_ART, C } = await import(pathToFileURL(outfile).href);

test('OMP chrome logo uses the official pi mark and inherits its visible brand color', () => {
  const mark = logo('omp');
  assert.match(mark.className, /logo-omp/);
  assert.equal(mark.children.length, 1);
  const svg = mark.children[0].markup;
  assert.match(svg, /fill="currentColor"/);
  assert.match(svg, /M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z/);
  const css = readFileSync(join(root, 'web/ui/styles.css'), 'utf8');
  assert.match(css, /--omp:\s*#38bdf8\s*;/i);
  assert.match(css, /\.logo-omp\s*\{\s*color:\s*var\(--omp\)/);
});

test('OMP screen marks stay recognizable as pi at TV and desk pixel sizes', () => {
  for (const size of [5, 7, 9]) {
    const icon = pixelLogo('omp', size, '#38bdf8');
    const rows = Array.from({ length: size }, () => Array(size).fill(false));
    for (const f of icon.g.fills) for (let y=f.y;y<f.y+f.h;y++) for (let x=f.x;x<f.x+f.w;x++) rows[y][x]=true;
    assert.equal(rows[0].filter(Boolean).length, size, 'pi has a full horizontal bar');
    const middle = rows[Math.floor(size/2)];
    const groups = middle.map(x=>x?'#':'.').join('').match(/#+/g);
    assert.equal(groups?.length, 2, 'two legs remain separate at small sizes');
    const bottom = rows.at(-1);
    assert.ok(bottom.some(Boolean));
    assert.ok(!bottom.slice(0,Math.floor(size/2)).some(Boolean), 'short left leg leaves the bottom open');
  }
});

const luminance = hex => {
  const a = hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return a[0]*.2126+a[1]*.7152+a[2]*.0722;
};
test('the OMP monitor screensaver actually draws a high-contrast OMP icon', () => {
  const images=[];const g={ fillStyle:'',globalAlpha:1,fillRect(){},drawImage(canvas){images.push(canvas)} };
  drawScreen(g,0,0,24,12,'idle','omp',0,0);
  assert.equal(images.length,1);
  const color=images[0].context.fills[0]?.color;
  assert.equal(color,BRAND_ART.omp.main);
  const values=[luminance(color),luminance(C.blue1)].sort((a,b)=>b-a);
  assert.ok((values[0]+.05)/(values[1]+.05)>=4.5,'icon remains visible on the blue monitor background');
});
