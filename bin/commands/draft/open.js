import path from 'node:path';

export async function run(args, context) {
  const { print, writeJson, EXIT } = context;
  const anon = process.env.DB8_ANON || 'anon';
  const idx = args.round ? String(args.round) : '0';
  const dir = path.join(process.cwd(), 'db8', `round-${idx}`, anon);
  const file = path.join(dir, 'draft.json');
  const template = {
    phase: 'submit',
    deadline_unix: 0,
    content: '',
    claims: [{ id: 'c1', text: '', support: [{ kind: 'citation', ref: '' }] }],
    citations: [{ url: '' }]
  };
  await writeJson(file, template);
  if (!args.json) print(`Draft at ${file}`);
  else print(JSON.stringify({ ok: true, path: file }));
  return EXIT.OK;
}
