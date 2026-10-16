type ProofRailProps = {
  eyebrow?: string;
  title?: string;
  body?: string;
  stats?: Array<{ label?: string; value?: string; detail?: string }>;
  cards?: Array<{ title?: string; body?: string; bullets?: string[] }>;
  links?: Array<{ label?: string; href?: string; tone?: string }>;
  footnote?: string;
};

export default function ProofRail({ eyebrow, title, body, stats, cards, links, footnote }: ProofRailProps) {
  return (
    <section className="space-y-6 rounded-3xl border border-border-soft bg-white p-8 shadow-card">
      {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">{eyebrow}</div> : null}
      {title ? <h2 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h2> : null}
      {body ? <p className="max-w-3xl text-sm leading-7 text-ink-700">{body}</p> : null}
      {stats?.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={`${stat.label}-${stat.value}`} className="rounded-2xl border border-border-soft bg-canvas-50 p-4">
              <div className="text-xs text-ink-500">{stat.label}</div>
              <div className="mt-1 font-semibold text-ink-900">{stat.value}</div>
              <p className="mt-2 text-xs leading-5 text-ink-600">{stat.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
      {cards?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-border-soft p-5">
              <h3 className="font-semibold text-ink-900">{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-700">{card.body}</p>
              {card.bullets?.length ? <ul className="mt-3 space-y-1 text-sm text-ink-600">{card.bullets.map((bullet) => <li key={bullet}>- {bullet}</li>)}</ul> : null}
            </article>
          ))}
        </div>
      ) : null}
      {links?.length ? <div className="flex flex-wrap gap-3">{links.map((link) => <a key={link.href} href={link.href} className="rounded-xl border border-border-soft px-4 py-2 text-sm font-semibold hover:bg-canvas-50">{link.label}</a>)}</div> : null}
      {footnote ? <p className="text-xs leading-5 text-ink-500">{footnote}</p> : null}
    </section>
  );
}
