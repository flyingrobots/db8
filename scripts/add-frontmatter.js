// Add consistent YAML frontmatter to Markdown files that lack it.
// - title: from first H1 if present, else from filename
// - lastUpdated: ISO date (YYYY-MM-DD)
// - tags/milestone for spec docs where appropriate
// Skips files already containing frontmatter.

import fs from 'node:fs';
import path from 'node:path';

const today = new Date().toISOString().slice(0, 10);

function hasFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return false;
  if (lines[0].trim() !== '---') return false;
  for (let i = 1; i < Math.min(lines.length, 50); i++) {
    if (lines[i].trim() === '---') return true;
  }
  return false;
}

function extractTitle(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return fallback;
}

function computeSpecMeta(file) {
  const base = path.basename(file).toLowerCase();
  const map = [
    { match: 'voting.md', milestone: 'M4: Votes & Final' },
    { match: 'scoringandreputation.md', milestone: 'M5: Scoring & Elo' },
    { match: 'researchtools.md', milestone: 'M6: Research Tools' },
    { match: 'attributioncontrol.md', milestone: 'M4: Votes & Final' },
    { match: 'orchestratorheartbeat.md', milestone: 'M7: Hardening & Ops' }
  ];
  for (const m of map) {
    if (base === m.match) return { tags: ['spec'], milestone: m.milestone };
  }
  return null;
}

function addFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (hasFrontmatter(text)) return false;
  const filenameTitle = path.basename(file).replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  const title = extractTitle(text, filenameTitle);
  const specMeta = file.includes('/docs/specs/') ? computeSpecMeta(file) : null;
  const lines = ['---', `title: ${title}`, `lastUpdated: ${today}`];
  if (specMeta) {
    lines.push('tags: [spec]');
    lines.push(`milestone: ${specMeta.milestone}`);
  }
  lines.push('---', '');
  fs.writeFileSync(file, lines.join('\n') + text);
  return true;
}

function shouldSkip(file) {
  if (file.includes('/node_modules/')) return true;
  if (file.includes('/web/.next/')) return true;
  return false;
}

const targets = process.argv.slice(2);
let changed = 0;
for (const f of targets) {
  if (shouldSkip(f)) continue;
  if (!fs.existsSync(f)) continue;
  if (path.extname(f).toLowerCase() !== '.md') continue;
  if (addFrontmatter(f)) changed++;
}
console.warn(`Frontmatter added to ${changed} files`);
