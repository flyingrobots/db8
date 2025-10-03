#!/usr/bin/env node
// Lightweight wrapper around gh project v2 to add issues to a project
// and set Status/Workflow/Milestone without wrangling GraphQL manually.
// Requires: gh CLI logged in (gh auth status) and repo access.

import { execSync } from 'node:child_process';

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts }).trim();
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : 'true';
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function getProject(owner, number, title) {
  if (!number && !title) throw new Error('Provide --project-number or --project-title');
  if (number) {
    // Also fetch node id via gh project list
    const json = sh(`gh project list --owner ${owner} --format json`);
    const data = JSON.parse(json);
    const proj = data.projects.find((p) => p.number === Number(number));
    if (!proj) throw new Error(`Project number ${number} not found for ${owner}`);
    return { number: proj.number, id: proj.id, title: proj.title };
  }
  const json = sh(`gh project list --owner ${owner} --format json`);
  const data = JSON.parse(json);
  const proj = data.projects.find((p) => p.title === title);
  if (!proj) throw new Error(`Project title '${title}' not found for ${owner}`);
  return { number: proj.number, id: proj.id, title: proj.title };
}

function getFields(owner, number) {
  const out = sh(`gh project field-list ${number} --owner ${owner} --format json`);
  const data = JSON.parse(out);
  const byName = Object.create(null);
  for (const f of data.fields) byName[f.name] = f;
  return byName;
}

function getItemId(owner, number, issueNum) {
  const out = sh(`gh project item-list ${number} --owner ${owner} -L 200 --format json`);
  const data = JSON.parse(out);
  const hit = data.items.find((it) => it.content && it.content.number === Number(issueNum));
  return hit ? hit.id : null;
}

function addIssueToProject(owner, number, issueNum) {
  const url = `https://github.com/${owner}/db8/issues/${issueNum}`;
  sh(`gh project item-add ${number} --owner ${owner} --url ${url}`);
}

function setSingleSelect({ itemId, projectId, field, optionName }) {
  const option = field.options.find((o) => o.name === optionName);
  if (!option) throw new Error(`Option '${optionName}' not found for field '${field.name}'`);
  sh(
    `gh project item-edit --id ${itemId} --field-id ${field.id} --project-id ${projectId} --single-select-option-id ${option.id}`
  );
}

function setMilestone(issueNum, milestoneTitle) {
  sh(`gh issue edit ${issueNum} --milestone ${JSON.stringify(milestoneTitle)}`);
}

function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0] || 'help';
  const owner = args.owner || 'flyingrobots';
  const projectNumber = args['project-number'] ? Number(args['project-number']) : undefined;
  const projectTitle = args['project-title'];
  if (cmd === 'help' || args.help) {
    console.warn(`
gh-project tool

Usage:
  node scripts/gh-project.js add --owner <owner> --project-title "db8 Roadmap" --issues 112,113 [--status "Todo"] [--workflow "Todo"] [--milestone "M1: MVP Loop"]
  node scripts/gh-project.js status --owner <owner> --project-title "db8 Roadmap" --issues 112 --status "In Progress" --workflow "In Progress"
  node scripts/gh-project.js milestone --issues 112,113 --milestone "M1: MVP Loop"

Notes:
  - Requires gh CLI auth. Run: gh auth status
  - Project owner defaults to 'flyingrobots'.
`);
    process.exit(0);
  }
  const issues = (args.issues || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (['add', 'status'].includes(cmd) && issues.length === 0) throw new Error('Provide --issues');

  const project = ['add', 'status'].includes(cmd)
    ? getProject(owner, projectNumber, projectTitle)
    : null;
  if (cmd === 'add') {
    const fields = getFields(owner, project.number);
    const statusField = fields['Status'];
    const workflowField = fields['Workflow'];
    for (const n of issues) {
      if (!getItemId(owner, project.number, n)) addIssueToProject(owner, project.number, n);
      const itemId = getItemId(owner, project.number, n);
      if (!itemId) throw new Error(`Unable to find project item for issue #${n}`);
      if (args.status)
        setSingleSelect({
          itemId,
          projectId: project.id,
          field: statusField,
          optionName: args.status
        });
      if (args.workflow)
        setSingleSelect({
          itemId,
          projectId: project.id,
          field: workflowField,
          optionName: args.workflow
        });
      if (args.milestone) setMilestone(n, args.milestone);
      console.warn(
        `#${n}: added to '${project.title}', status='${args.status || ''}', workflow='${
          args.workflow || ''
        }', milestone='${args.milestone || ''}'`
      );
    }
    return;
  }
  if (cmd === 'status') {
    const fields = getFields(owner, project.number);
    const statusField = fields['Status'];
    const workflowField = fields['Workflow'];
    for (const n of issues) {
      const itemId = getItemId(owner, project.number, n);
      if (!itemId) throw new Error(`Issue #${n} not found in project '${project.title}'`);
      if (args.status)
        setSingleSelect({
          itemId,
          projectId: project.id,
          field: statusField,
          optionName: args.status
        });
      if (args.workflow)
        setSingleSelect({
          itemId,
          projectId: project.id,
          field: workflowField,
          optionName: args.workflow
        });
      console.warn(`#${n}: set status='${args.status || ''}', workflow='${args.workflow || ''}'`);
    }
    return;
  }
  if (cmd === 'milestone') {
    if (issues.length === 0) throw new Error('Provide --issues for milestone');
    if (!args.milestone) throw new Error('Provide --milestone');
    for (const n of issues) {
      setMilestone(n, args.milestone);
      console.warn(`#${n}: milestone='${args.milestone}'`);
    }
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
}

try {
  main();
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
