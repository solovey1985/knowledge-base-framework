import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { mountPlugin } from '../../core/mount';
import { Button } from '../../shared/controls';
import { MarkdownFragment } from '../../shared/MarkdownFragment';
import { getDefaultSections, highlightCard, loadState, readPayloads, saveState } from './model';
import type { TechMemoryItemState, TechMemoryPayload } from './model';

function Concepts({ cards }: { cards: { payload: TechMemoryPayload; slot: HTMLElement }[] }) {
  const [state, setState] = useState(loadState);
  useEffect(() => saveState(state), [state]);
  function update(id: string, item: TechMemoryItemState) {
    setState(previous => ({ ...previous, items: { ...previous.items, [id]: item } }));
  }
  function switchMode() {
    setState(previous => {
      const recallMode = !previous.recallMode;
      const items = Object.fromEntries(Object.entries(previous.items).map(([id, item]) =>
        [id, { ...item, sections: getDefaultSections(recallMode) }]));
      return { ...previous, recallMode, items };
    });
  }
  const known = cards.filter(({ payload }) => state.items[payload.id]?.status === 'known').length;
  const review = cards.filter(({ payload }) => state.items[payload.id]?.status === 'review').length;
  return <>
    <h2 className="text-xl font-semibold">{known} of {cards.length} known</h2>
    <p>{review} to review</p>
    <Button icon="icon-[lucide--brain]" onClick={switchMode}>{state.recallMode ? 'Study mode' : 'Recall mode'}</Button>
    <Button icon="icon-[lucide--rotate-ccw]" onClick={() => setState({ pageId: state.pageId, recallMode: false, items: {} })}>Reset progress</Button>
    {cards.map(({ payload, slot }) => {
      const item = state.items[payload.id] ?? {};
      const sections = item.sections ?? getDefaultSections(Boolean(state.recallMode));
      const toggle = (key: string) => update(payload.id, { ...item, sections: { ...sections, [key]: !sections[key] } });
      return createPortal(<article id={`concept-${payload.id}`} className="mt-8 space-y-4 rounded-2xl border bg-white p-6">
        <h3 className="text-2xl font-semibold">{payload.term}</h3>
        <p>{item.status ?? 'new'}</p>
        {payload.aliases.length > 0 && <p>Aliases: {payload.aliases.join(', ')}</p>}
        {(['parents', 'children', 'related'] as const).map(key => payload[key].length > 0 && <div key={key} className="flex flex-wrap gap-2">
          <strong>{key}</strong>{payload[key].map((relation, i) => relation.targetId
            ? <a key={i} href={`#concept-${relation.targetId}`} onClick={() => highlightCard(relation.targetId!)}>{relation.label}</a>
            : <span key={i}>{relation.label}</span>)}
        </div>)}
        {(['summary', 'details', 'example', 'mnemonic', 'recall'] as const).map(key => {
          const fragments = key === 'recall' ? payload.recallHtml : [payload[`${key}Html`]].filter(Boolean);
          return fragments.length > 0 && <section key={key}>
            <Button icon="icon-[lucide--chevron-down]" aria-expanded={Boolean(sections[key])} onClick={() => toggle(key)}>{key}</Button>
            {sections[key] && fragments.map((html, i) => <MarkdownFragment key={i} html={html} />)}
          </section>;
        })}
        <Button icon="icon-[lucide--check]" onClick={() => update(payload.id, { ...item, status: 'known' })}>Mark known</Button>
        <Button icon="icon-[lucide--clock]" onClick={() => update(payload.id, { ...item, status: 'review' })}>Review later</Button>
        <Button icon="icon-[lucide--rotate-ccw]" onClick={() => update(payload.id, { status: 'new', sections: getDefaultSections(Boolean(state.recallMode)) })}>Reset card</Button>
      </article>, slot, payload.id);
    })}
  </>;
}

mountPlugin('[data-kb-tech-memory-progress]', host => {
  const cards = readPayloads().flatMap(payload => {
    const slot = document.querySelector<HTMLElement>(`[data-kb-tech-memory-id="${CSS.escape(payload.id)}"]`);
    return slot ? [{ payload, slot }] : [];
  });
  const root = createRoot(host);
  if (cards.length) root.render(<Concepts cards={cards} />);
  return () => root.unmount();
});
