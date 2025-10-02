// Reflow Markdown files to satisfy markdownlint (MD013, MD029, MD040, MD034)
// - Wrap paragraphs and list items at 80 cols
// - Normalize ordered lists to "1." style
// - Add language to bare code fences (text)
// - Wrap long code fence lines at 80 with simple soft breaks
// - Wrap bare URLs in <...>

import fs from 'node:fs';

const WIDTH = 80;

function listBulletPrefix(l) {
  const m = l.match(/^(\s*[-*]\s+)(.*)$/);
  if (!m) return null;
  return { prefix: m[1], text: m[2].trim() };
}

function listNumPrefix(l) {
  const m = l.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (!m) return null;
  return { prefix: m[1] + '1. ', text: m[3].trim() };
}

function blockPrefix(l) {
  const m = l.match(/^(\s*>\s?)(.*)$/);
  if (!m) return null;
  return { prefix: m[1], text: m[2].trim() };
}

function pushWrapped(out, prefix, text, cont) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    out.push(prefix.trim() ? prefix.trim() : '');
    return;
  }
  let line = prefix.trimEnd();
  if (!line) line = '';
  for (const w of words) {
    const add = (line.length ? 1 : 0) + w.length;
    if (line.length + add > WIDTH) {
      out.push(line);
      line = cont + w;
    } else {
      line += (line ? ' ' : '') + w;
    }
  }
  out.push(line);
}

function wrapCodeLine(line) {
  if (line.length <= WIDTH) return [line];
  const indent = line.match(/^\s*/)[0];
  let s = line.trimStart();
  const out = [];
  while (s.length > WIDTH - indent.length) {
    const cut = WIDTH - indent.length;
    let pos = Math.max(s.lastIndexOf(', ', cut), s.lastIndexOf(' ', cut));
    if (pos <= 0) pos = cut;
    out.push(indent + s.slice(0, pos).trimEnd());
    s = s.slice(pos).trimStart();
  }
  if (s.length) out.push(indent + s);
  return out;
}

function reflowText(text) {
  const lines = text.split(/\r?\n/);
  // MD041: ensure first line H1
  if (lines.length && /^##\s/.test(lines[0])) {
    lines[0] = lines[0].replace(/^##\s/, '# ');
  }
  // preprocess: language on bare fences; wrap bare URLs in <...>
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '```') lines[i] = l.replace(/```/, '```text');
    lines[i] = lines[i].replace(
      /(^|[^(<[])(https?:\/\/[^\s)\]>]+)/g,
      (m, p, url) => p + '<' + url + '>'
    );
  }

  const out = [];
  let i = 0;
  let inCode = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      out.push(line);
      i++;
      continue;
    }
    if (inCode) {
      out.push(...wrapCodeLine(line));
      i++;
      continue;
    }
    if (line.trim() === '') {
      out.push('');
      i++;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      out.push(line.trim());
      i++;
      continue;
    }
    const num = listNumPrefix(line);
    if (num) {
      const { prefix, text: rest } = num;
      const cont = ' '.repeat(prefix.length);
      let acc = rest;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        if (/^#{1,6}\s/.test(l)) break;
        if (listBulletPrefix(l) || listNumPrefix(l) || blockPrefix(l)) break;
        acc += ' ' + l.trim();
        i++;
      }
      pushWrapped(out, prefix, acc, cont);
      continue;
    }
    const bul = listBulletPrefix(line) || blockPrefix(line);
    if (bul) {
      const { prefix, text: rest } = bul;
      const cont = ' '.repeat(prefix.length);
      let acc = rest;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        if (/^#{1,6}\s/.test(l)) break;
        if (listBulletPrefix(l) || listNumPrefix(l) || blockPrefix(l)) break;
        acc += ' ' + l.trim();
        i++;
      }
      pushWrapped(out, prefix, acc, cont);
      continue;
    }
    let acc = line.trim();
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') break;
      if (/^#{1,6}\s/.test(l)) break;
      if (listBulletPrefix(l) || listNumPrefix(l) || blockPrefix(l)) break;
      acc += ' ' + l.trim();
      i++;
    }
    pushWrapped(out, '', acc, '');
  }
  return out.join('\n');
}

const targets = process.argv.slice(2);
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, reflowText(src));
}
console.warn('Refactor complete for', targets.length, 'files');
