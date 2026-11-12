import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { mountPlugin } from '../../core/mount';
import { Button } from '../../shared/controls';
import { MarkdownFragment } from '../../shared/MarkdownFragment';
import { formatLocalDate, loadState, readPayloads, saveState, validateCodeDraft } from './model';
import type { InterviewItemState, InterviewPayload } from './model';

type CardProps = {
  payload: InterviewPayload;
  state: InterviewItemState;
  update: (patch: Partial<InterviewItemState>) => void;
};

function Exercise({ payload, state, update }: CardProps) {
  if (payload.kind === 'question') {
    const used = state.hintsUsed ?? 0;
    return <>
      {payload.hintsHtml.slice(0, used).map((hint, i) => <MarkdownFragment key={i} html={hint} />)}
      <Button icon="icon-[lucide--lightbulb]" disabled={used >= payload.hintsHtml.length} onClick={() => update({ hintsUsed: used + 1 })}>Show hint</Button>
      <Button icon="icon-[lucide--eye]" onClick={() => update({ revealed: true })}>Reveal answer</Button>
      {state.revealed && <MarkdownFragment html={payload.answerHtml} />}
    </>;
  }
  if (payload.kind === 'choice') {
    return <>
      {payload.optionsHtml.map((option, index) => <label key={index} className="flex items-start gap-3 rounded-xl border p-3">
        <input type="radio" name={payload.id} checked={state.selectedOption === index}
          onChange={() => update({ selectedOption: index, checked: false })} />
        <MarkdownFragment html={option} />
      </label>)}
      <Button icon="icon-[lucide--check]" onClick={() => update({ checked: true, correct: state.selectedOption === payload.correctIndex })}>Check answer</Button>
      {state.checked && <><p>{state.correct ? 'Correct.' : 'Try again.'}</p><MarkdownFragment html={payload.explanationHtml} /></>}
    </>;
  }
  const draft = state.codeDraft ?? payload.starterCode;
  return <>
    <textarea aria-label="Your draft" className="min-h-64 w-full rounded-xl bg-slate-950 p-4 font-mono text-slate-100"
      value={draft} onChange={event => update({ codeDraft: event.target.value, checked: false })} />
    <p>Reference starter</p><pre><code>{payload.starterCode}</code></pre>
    <Button icon="icon-[lucide--check]" onClick={() => update({ checked: true, correct: validateCodeDraft(draft, payload) })}>Check answer</Button>
    {state.checked && <p>{state.correct ? 'Check passed.' : 'Check failed.'}</p>}
    <Button icon="icon-[lucide--eye]" onClick={() => update({ solutionRevealed: true })}>Reveal solution</Button>
    {state.solutionRevealed && <pre><code>{payload.solutionCode}</code></pre>}
  </>;
}

function InterviewPage({ cards }: { cards: { payload: InterviewPayload; slot: HTMLElement }[] }) {
  const [state, setState] = useState(() => {
    const saved = loadState();
    saved.startedAt ??= new Date().toISOString();
    return saved;
  });
  useEffect(() => saveState(state), [state]);
  const done = cards.filter(({ payload }) => state.items[payload.id]?.completed).length;
  function update(id: string, patch: Partial<InterviewItemState>) {
    setState(previous => {
      const items = { ...previous.items, [id]: { ...previous.items[id], ...patch } };
      const complete = cards.every(({ payload }) => items[payload.id]?.completed);
      return { ...previous, items, completedAt: complete ? previous.completedAt ?? new Date().toISOString() : undefined };
    });
  }
  return <>
    <h2 className="text-xl font-semibold">{done} of {cards.length} completed</h2>
    <progress max={cards.length} value={done} aria-label="Interview progress" />
    <p>Started {formatLocalDate(state.startedAt!)}</p>
    {state.completedAt && <p>Completed {formatLocalDate(state.completedAt)}</p>}
    <Button icon="icon-[lucide--rotate-ccw]" onClick={() => setState({ pageId: state.pageId, items: {}, startedAt: new Date().toISOString() })}>Reset progress</Button>
    {cards.map(({ payload, slot }, index) => {
      const item = state.items[payload.id] ?? {};
      return createPortal(<section className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h3>{payload.kind} {index + 1}</h3>
        <MarkdownFragment html={payload.promptHtml} />
        <Exercise payload={payload} state={item} update={patch => update(payload.id, patch)} />
        <Button icon="icon-[lucide--circle-check]" onClick={() => update(payload.id, { completed: !item.completed })}>{item.completed ? 'Mark incomplete' : 'Mark complete'}</Button>
      </section>, slot, payload.id);
    })}
  </>;
}

mountPlugin('[data-kb-interview-progress]', host => {
  const cards = readPayloads().flatMap(payload => {
    const slot = document.querySelector<HTMLElement>(`[data-kb-interview-id="${CSS.escape(payload.id)}"]`);
    return slot ? [{ payload, slot }] : [];
  });
  const root = createRoot(host);
  if (cards.length) root.render(<InterviewPage cards={cards} />);
  return () => root.unmount();
});
