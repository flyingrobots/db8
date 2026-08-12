'use client';

import { Button } from '@/components/ui/button';
import {
  NODE_KINDS,
  NODE_LABELS,
  NODE_HINTS,
  FRAME_KINDS,
  FRAME_FIELDS,
  TRANSPARENT_FRAMES,
  emptyNode,
  emptyFrame,
  describeTerm
} from '@/lib/claimTerm';

// A recursive editor for one claim term.
//
// The shape it produces is the one server/claims/terms.js validates. It edits a
// tree in place through an onChange callback rather than holding state itself,
// so the whole term stays a single value the submitting component owns.

const inputClass =
  'w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

function KindSelect({ value, onChange, id }) {
  return (
    <select
      id={id}
      className={inputClass + ' max-w-[12rem]'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Node kind"
    >
      {NODE_KINDS.map((k) => (
        <option key={k} value={k}>
          {NODE_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

function EntityInput({ value, onChange, label, id }) {
  return (
    <label className="block text-xs" htmlFor={id}>
      <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
      <input
        id={id}
        className={inputClass}
        value={value?.name ?? ''}
        placeholder="e.g. the_study"
        onChange={(e) => onChange({ kind: 'named', name: e.target.value })}
      />
    </label>
  );
}

function ClaimFields({ node, onChange, idPrefix }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <EntityInput
        id={`${idPrefix}-subject`}
        label="Subject"
        value={node.subject}
        onChange={(subject) => onChange({ ...node, subject })}
      />
      <label className="block text-xs" htmlFor={`${idPrefix}-predicate`}>
        <span className="text-neutral-600 dark:text-neutral-400">Predicate</span>
        <input
          id={`${idPrefix}-predicate`}
          className={inputClass}
          value={node.predicate ?? ''}
          placeholder="reduces"
          onChange={(e) => onChange({ ...node, predicate: e.target.value })}
        />
      </label>
      <label className="block text-xs" htmlFor={`${idPrefix}-object`}>
        <span className="text-neutral-600 dark:text-neutral-400">Object</span>
        <input
          id={`${idPrefix}-object`}
          className={inputClass}
          value={typeof node.object === 'string' ? node.object : ''}
          placeholder="productivity"
          onChange={(e) => onChange({ ...node, object: e.target.value })}
        />
      </label>
    </div>
  );
}

function FrameFields({ node, onChange, idPrefix }) {
  const kind = node.frame?.kind ?? 'attribution';
  const spec = FRAME_FIELDS[kind];
  const opaque = !TRANSPARENT_FRAMES.includes(kind);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-xs" htmlFor={`${idPrefix}-frame`}>
        <span className="text-neutral-600 dark:text-neutral-400">Frame</span>
        <select
          id={`${idPrefix}-frame`}
          className={inputClass}
          value={kind}
          onChange={(e) => onChange({ ...node, frame: emptyFrame(e.target.value) })}
        >
          {FRAME_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      {spec ? (
        spec.entity ? (
          <EntityInput
            id={`${idPrefix}-frame-value`}
            label={spec.label}
            value={node.frame?.[spec.field]}
            onChange={(v) => onChange({ ...node, frame: { ...node.frame, [spec.field]: v } })}
          />
        ) : (
          <label className="block text-xs" htmlFor={`${idPrefix}-frame-value`}>
            <span className="text-neutral-600 dark:text-neutral-400">{spec.label}</span>
            <input
              id={`${idPrefix}-frame-value`}
              className={inputClass}
              value={node.frame?.[spec.field] ?? ''}
              onChange={(e) =>
                onChange({ ...node, frame: { ...node.frame, [spec.field]: e.target.value } })
              }
            />
          </label>
        )
      ) : null}

      <p className="sm:col-span-2 text-xs text-neutral-600 dark:text-neutral-400">
        {opaque
          ? 'Opaque: nothing inside is asserted about the world. A checker may still rule on whether the source said it.'
          : 'Transparent: the proposition inside is still asserted, narrowed by this context.'}
      </p>
    </div>
  );
}

function ChildSlot({ label, node, onChange, depth, idPrefix }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <ClaimTermEditor node={node} onChange={onChange} depth={depth + 1} idPrefix={idPrefix} />
    </div>
  );
}

function ListSlot({ label, items, onChange, depth, idPrefix, minItems }) {
  const set = (i, next) => onChange(items.map((item, j) => (j === i ? next : item)));
  const add = () => onChange([...items, emptyNode('claim')]);
  const remove = (i) => onChange(items.filter((_, j) => j !== i));

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add
        </Button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="mb-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs text-neutral-500">#{i + 1}</span>
            {items.length > minItems ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
                Remove
              </Button>
            ) : null}
          </div>
          <ClaimTermEditor
            node={item}
            onChange={(next) => set(i, next)}
            depth={depth + 1}
            idPrefix={`${idPrefix}-${i}`}
          />
        </div>
      ))}
    </div>
  );
}

export function ClaimTermEditor({ node, onChange, depth = 0, idPrefix = 'term' }) {
  const kind = node?.kind ?? 'claim';

  return (
    <div
      className={depth === 0 ? '' : 'border-l-2 border-neutral-200 pl-3 dark:border-neutral-800'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindSelect
          id={`${idPrefix}-kind`}
          value={kind}
          onChange={(next) => onChange(emptyNode(next))}
        />
        <span className="text-xs text-neutral-500">{NODE_HINTS[kind]}</span>
      </div>

      <div className="mt-2">
        {kind === 'claim' ? (
          <ClaimFields node={node} onChange={onChange} idPrefix={idPrefix} />
        ) : null}

        {kind === 'framed' ? (
          <>
            <FrameFields node={node} onChange={onChange} idPrefix={idPrefix} />
            <ChildSlot
              label="body"
              node={node.body}
              onChange={(body) => onChange({ ...node, body })}
              depth={depth}
              idPrefix={`${idPrefix}-body`}
            />
          </>
        ) : null}

        {kind === 'all' ? (
          <ListSlot
            label="parts"
            items={node.parts ?? []}
            onChange={(parts) => onChange({ ...node, parts })}
            depth={depth}
            idPrefix={`${idPrefix}-parts`}
            minItems={1}
          />
        ) : null}

        {kind === 'either' ? (
          <ListSlot
            label="options"
            items={node.options ?? []}
            onChange={(options) => onChange({ ...node, options })}
            depth={depth}
            idPrefix={`${idPrefix}-options`}
            minItems={2}
          />
        ) : null}

        {kind === 'denial' ? (
          <ChildSlot
            label="body"
            node={node.body}
            onChange={(body) => onChange({ ...node, body })}
            depth={depth}
            idPrefix={`${idPrefix}-body`}
          />
        ) : null}

        {kind === 'conditional' ? (
          <>
            <ChildSlot
              label="when"
              node={node.when}
              onChange={(when) => onChange({ ...node, when })}
              depth={depth}
              idPrefix={`${idPrefix}-when`}
            />
            <ChildSlot
              label="then"
              node={node.then}
              onChange={(then) => onChange({ ...node, then })}
              depth={depth}
              idPrefix={`${idPrefix}-then`}
            />
          </>
        ) : null}

        {kind === 'concession' ? (
          <>
            <ChildSlot
              label="even if"
              node={node.even_if}
              onChange={(even_if) => onChange({ ...node, even_if })}
              depth={depth}
              idPrefix={`${idPrefix}-evenif`}
            />
            <ChildSlot
              label="still"
              node={node.still}
              onChange={(still) => onChange({ ...node, still })}
              depth={depth}
              idPrefix={`${idPrefix}-still`}
            />
          </>
        ) : null}
      </div>

      {depth === 0 ? (
        <p className="mt-3 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          Reads as: {describeTerm(node)}
        </p>
      ) : null}
    </div>
  );
}

export default ClaimTermEditor;
