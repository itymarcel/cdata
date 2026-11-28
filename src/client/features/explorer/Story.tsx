import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { NoteLine, RichText, StoryNote, VitalStory } from "@shared/types.ts";
import { useVitals } from "../../api/queries.ts";
import { EvidenceBadge } from "../../components/EvidenceBadge.tsx";
import { useDashboard } from "../../state/store.ts";

/**
 * Text runs with the key figures emphasised. With `onNote`, a figure that has a
 * note becomes a button that opens it.
 */
export function Rich({ text, onNote, openNote }: { text: RichText; onNote?: (id: string) => void; openNote?: string | null }) {
  return (
    <>
      {text.map((part, i) => {
        if (typeof part === "string") return <span key={i}>{part}</span>;
        if (!part.note || !onNote) return <strong key={i}>{part.em}</strong>;
        const id = part.note;
        return (
          <button
            key={i}
            type="button"
            className={`xp-em${openNote === id ? " is-open" : ""}`}
            aria-expanded={openNote === id}
            title="What this means, why it matters and how we know"
            onClick={() => onNote(id)}
          >
            {part.em}
          </button>
        );
      })}
    </>
  );
}

/**
 * The plain-language headline. Its key figures open a card that puts them in
 * context: what the figure means, why it matters, how we know.
 */
export function Headline({ story }: { story: VitalStory }) {
  const [open, setOpen] = useState<string | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const headlineNotes = story.headline.flatMap((p) => (typeof p !== "string" && p.note ? [p.note] : []));
  const notes = headlineNotes.flatMap((id) => story.notes.filter((n) => n.id === id));
  const note = notes.find((n) => n.id === open) ?? null;

  // The card floats over the page, under the headline: the explorer panel is
  // often too short to hold it, and clips its overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const placeCard = () => {
      const r = lineRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(620, window.innerWidth - 32);
      const top = r.bottom + 8;
      setPlace({ top, left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)), width, maxHeight: Math.max(200, window.innerHeight - top - 16) });
    };
    placeCard();
    window.addEventListener("resize", placeCard);
    window.addEventListener("scroll", placeCard, true);
    return () => {
      window.removeEventListener("resize", placeCard);
      window.removeEventListener("scroll", placeCard, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  return (
    <div className="xp-headline-wrap" ref={ref}>
      <p className="xp-headline" ref={lineRef}>
        <Rich text={story.headline} onNote={toggle} openNote={open} />
        {notes.length > 0 && !note && (
          <button type="button" className="xp-why" onClick={() => setOpen(notes[0]!.id)}>
            What does this mean?
          </button>
        )}
      </p>
      {note && (
        <div className="xp-note-card" role="dialog" aria-label={note.title} style={place}>
          <div className="xp-note-card__head">
            {notes.length > 1 ? (
              <div className="xp-note-card__tabs" role="tablist">
                {notes.map((n) => (
                  <button key={n.id} type="button" role="tab" aria-selected={n.id === note.id} onClick={() => setOpen(n.id)}>
                    {n.title}
                  </button>
                ))}
              </div>
            ) : (
              <h3 className="xp-note-card__title">{note.title}</h3>
            )}
            <button type="button" className="xp-note-card__close" aria-label="Close" onClick={() => setOpen(null)}>
              ×
            </button>
          </div>
          <NoteBody note={note} />
        </div>
      )}
    </div>
  );
}

const SECTIONS = [
  ["meaning", "What it means"],
  ["matters", "Why it matters"],
  ["howWeKnow", "How we know"],
] as const;

/** A note's three sections; empty ones are left out. */
export function NoteBody({ note }: { note: StoryNote }) {
  return (
    <div className="xp-note">
      {SECTIONS.map(([key, title]) =>
        note[key].length === 0 ? null : (
          <section key={key} className="xp-note__section">
            <h4 className="xp-note__heading">{title}</h4>
            <ul className="xp-note__lines">
              {note[key].map((line, i) => (
                <Line key={i} line={line} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function Line({ line }: { line: NoteLine }) {
  const setView = useDashboard((s) => s.setView);
  const { data: vitals } = useVitals();
  const linked = line.link ? (vitals?.find((v) => v.id === line.link)?.label ?? line.link) : null;
  return (
    <li className="xp-note__line">
      <p className="xp-note__text">
        <Rich text={line.text} />
        {line.link && (
          <>
            {" "}
            <button type="button" className="xp-note__link" onClick={() => setView(line.link!)}>
              {linked} →
            </button>
          </>
        )}
      </p>
      {line.cite ? (
        <details className="xp-cite">
          <summary>
            <EvidenceBadge evidence="curated" compact /> {line.cite.label}
          </summary>
          <blockquote className="xp-cite__quote">{line.cite.quote}</blockquote>
          <a className="xp-cite__link" href={line.cite.url} target="_blank" rel="noreferrer">
            Read it in the report ↗
          </a>
        </details>
      ) : (
        line.basis && <p className="xp-fact__basis">{line.basis}</p>
      )}
    </li>
  );
}

/**
 * The data-derived facts behind the headline, each with the series and
 * calculation it comes from, so a reader can check any number. A fact with a
 * note gets an info toggle that opens it in place.
 */
export function KeyFacts({ story }: { story: VitalStory }) {
  return (
    <ul className="xp-facts">
      {story.facts.map((f, i) => (
        <Fact key={i} text={f.text} basis={f.basis} note={story.notes.find((n) => n.id === f.note) ?? null} />
      ))}
    </ul>
  );
}

function Fact({ text, basis, note }: { text: RichText; basis: string; note: StoryNote | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const noteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) noteRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  return (
    <li className="xp-fact">
      <p className="xp-fact__text">
        <Rich text={text} />
        {note && (
          <button
            type="button"
            className={`xp-info${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-controls={id}
            aria-label={`${open ? "Hide" : "Show"} context: ${note.title}`}
            title={note.title}
            onClick={() => setOpen((o) => !o)}
          >
            i
          </button>
        )}
      </p>
      <p className="xp-fact__basis">{basis}</p>
      {note && open && (
        <div id={id} ref={noteRef} className="xp-fact__note">
          <h4 className="xp-note-card__title">{note.title}</h4>
          <NoteBody note={note} />
        </div>
      )}
    </li>
  );
}
