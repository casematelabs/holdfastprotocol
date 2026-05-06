/* ============================================================================
   CASEMATE LABS — DIGEST
   Volume I · MMXXVI
   A published specification for trust infrastructure.
   ============================================================================ */

const { useState, useEffect, useRef, useMemo } = React;

/* ---------- DATA ---------- */
const PROTOCOLS = [
  {
    id: '01', roman: 'I',
    name: 'Holdfast Protocol',
    flagship: true,
    desc: 'Trust infrastructure for autonomous AI agents on Solana. Hardware-attested identity, programmable escrow, and on-chain reputation.',
    stack: 'Solana · Rust',
    status: 'PUBLIC',
  },
  {
    id: '02', roman: 'II',
    name: 'ProofRelay',
    desc: 'Verification and relay layer for cryptographic proofs across protocols.',
    stack: 'Cryptography · TypeScript',
    status: 'PRIVATE',
  },
  {
    id: '03', roman: 'III',
    name: 'Hardline Protocol',
    desc: 'Immutable security primitives and fail-safes for decentralised applications.',
    stack: 'Security · Protocol',
    status: 'PRIVATE',
  },
  {
    id: '04', roman: 'IV',
    name: 'Edict Protocol',
    desc: 'Decentralised rules engine and governance primitives for programmable jurisdictions.',
    stack: 'Smart contracts · TypeScript',
    status: 'PRIVATE',
  },
  {
    id: '05', roman: 'V',
    name: 'DeterminOS',
    desc: 'Deterministic execution environment for verifiable compute on heterogeneous hardware.',
    stack: 'Core OS · TypeScript',
    status: 'PRIVATE',
  },
  {
    id: '06', roman: 'VI',
    name: 'Holdfast Eliza',
    desc: 'An ElizaOS SDK by the Holdfast team. Embeds Holdfast identity, escrow, and reputation directly into the Eliza agent runtime.',
    stack: 'ElizaOS · SDK',
    status: 'PUBLIC',
  },
];

const DOCTRINE = [
  { roman: 'I',   t: 'Determinism over magic.',     b: 'Every transition has a reason. Every state is verifiable. We do not ship behaviour we cannot explain.' },
  { roman: 'II',  t: 'Specs before code.',          b: 'Threat models, invariants, and acceptance gates are written before a single line is committed.' },
  { roman: 'III', t: 'Minimum viable surface.',     b: 'Less code, smaller blast radius. We ruthlessly trim API surface, dependencies, and on-chain footprint.' },
  { roman: 'IV',  t: 'Audit-grade quality gates.',  b: 'No release bypasses our internal cryptographic, performance, and accessibility thresholds.' },
  { roman: 'V',   t: 'Security before scale.',      b: 'We will not trade verifiability for throughput. Adversarial conditions are the default, not the edge case.' },
  { roman: 'VI',  t: 'Protocols others build on.',  b: 'We design primitives that compound. Counterparties, agents, and applications should be easier to verify because of our work.' },
];

const CHAPTERS = [
  { id: 'cover',     num: '00', label: 'Cover' },
  { id: 'abstract',  num: '01', label: 'Abstract' },
  { id: 'protocols', num: '02', label: 'Index' },
  { id: 'holdfast',  num: '03', label: 'Holdfast' },
  { id: 'doctrine',  num: '04', label: 'Doctrine' },
  { id: 'engage',    num: '05', label: 'Engagement' },
];

/* ---------- HOOKS ---------- */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);
  return now;
}

function useActiveChapter() {
  const [active, setActive] = useState('cover');
  useEffect(() => {
    const ids = CHAPTERS.map(c => c.id);
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      const inView = entries.filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (inView[0]) setActive(inView[0].target.id);
    }, { rootMargin: '-30% 0px -55% 0px', threshold: [0.05, 0.25, 0.5] });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.setAttribute('data-revealed', 'true');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ---------- DOCUMENT BAR ---------- */
const DocBar = () => {
  const now = useClock();
  const time = now.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  return (
    <div className="docbar" role="banner">
      <div className="docbar-l">
        <span>Casemate Labs · Digest</span>
        <span style={{ color: 'var(--paper-faint)' }}>Volume I</span>
      </div>
      <div className="docbar-c">
        <span className="docbar-stamp">Public</span>
        <span style={{ color: 'var(--paper-faint)' }}>·</span>
        <span>Specification</span>
      </div>
      <div className="docbar-r">
        <span className="docbar-pulse">In service</span>
        <span style={{ color: 'var(--paper-faint)' }}>{date} · {time} GMT</span>
      </div>
    </div>
  );
};

/* ---------- CHAPTER INDEX (right rail) ---------- */
const ChapterIndex = ({ active }) => {
  const jump = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav className="chapter-index" aria-label="Chapter index">
      {CHAPTERS.map(c => (
        <button
          key={c.id}
          className={`chapter-index-link ${active === c.id ? 'is-active' : ''}`}
          onClick={() => jump(c.id)}
        >
          <span className="chapter-index-num">§{c.num}</span>
          <span className="chapter-index-label">{c.label}</span>
          <span className="chapter-index-rule" aria-hidden="true"/>
        </button>
      ))}
    </nav>
  );
};

/* ---------- COVER SEAL (geometric mark) ---------- */
const CoverSeal = () => (
  <div className="cover-seal" aria-hidden="true">
    <svg viewBox="0 0 200 200" className="cover-seal-svg">
      <defs>
        <path id="rim" d="M100,100 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0"/>
      </defs>

      {/* Outer rotating ring with tick labels */}
      <g className="cover-seal-rotate">
        <circle className="ring" cx="100" cy="100" r="92"/>
        <circle className="ring-2" cx="100" cy="100" r="86"/>
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const r1 = i % 5 === 0 ? 80 : 84;
          const r2 = 88;
          const x1 = 100 + Math.cos(a) * r1;
          const y1 = 100 + Math.sin(a) * r1;
          const x2 = 100 + Math.cos(a) * r2;
          const y2 = 100 + Math.sin(a) * r2;
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              className={i % 5 === 0 ? 'tick-major' : 'tick'}
            />
          );
        })}

        {/* Cardinal labels along rim */}
        <text className="label-tight" textAnchor="middle">
          <textPath href="#rim" startOffset="0%">CASEMATE · LABS · TRUST PRIMITIVES · VOL I · MMXXVI · </textPath>
        </text>
      </g>

      {/* Inner static structure */}
      <g>
        {/* Hexagonal vault */}
        <polygon points="100,38 154,68 154,132 100,162 46,132 46,68"
                 fill="none" stroke="var(--paper-mute)" strokeWidth="0.6"/>
        <polygon points="100,58 137,78 137,122 100,142 63,122 63,78"
                 fill="none" stroke="var(--paper-faint)" strokeWidth="0.5"/>

        {/* Crosshair */}
        <line x1="100" y1="38" x2="100" y2="162" className="crosshair"/>
        <line x1="46" y1="100" x2="154" y2="100" className="crosshair"/>

        {/* Center mark */}
        <circle cx="100" cy="100" r="3" className="center"/>
        <circle cx="100" cy="100" r="10" fill="none" stroke="var(--seal)" strokeWidth="0.5"/>
        <circle cx="100" cy="100" r="20" fill="none" stroke="var(--paper-faint)" strokeWidth="0.4"/>

        {/* Initials mark */}
        <text x="100" y="178" textAnchor="middle" className="seal-mark">C · L</text>

        {/* Top mark */}
        <text x="100" y="32" textAnchor="middle" className="label-tight">N</text>
        <text x="100" y="174" textAnchor="middle" className="label-tight">S</text>
        <text x="36" y="103" textAnchor="middle" className="label-tight">W</text>
        <text x="164" y="103" textAnchor="middle" className="label-tight">E</text>
      </g>
    </svg>
  </div>
);

/* ---------- §00 COVER ---------- */
const Cover = () => (
  <section id="cover" className="cover" data-reveal>
    <header className="cover-top reveal reveal-1">
      <div>
        <span style={{ color: 'var(--paper-faint)' }}>Folio</span>{' '}
        <span style={{ color: 'var(--paper-2)' }}>§00 · Cover</span>
      </div>
      <div>
        <span className="cover-top-stamp">Volume I</span>
      </div>
      <div>
        Issued · MMXXVI
      </div>
    </header>

    <div className="cover-body">
      <div className="cover-eyebrow reveal reveal-2">
        <span className="cover-eyebrow-rule" aria-hidden="true"/>
        Casemate Laboratories · Specification
      </div>

      <h1 className="cover-mark reveal reveal-3">
        <span>Trust primitives</span><br/>
        <span className="it">for the autonomous</span><br/>
        <span>web<span className="punct">.</span></span>
      </h1>

      <p className="cover-sub reveal reveal-4">
        Casemate Labs designs <em>security-first protocols</em> and software for identity, trust, autonomous systems, and digital asset control. We build the layer beneath verifiable agents, programmable counterparties, and durable digital capital.
      </p>

      <div className="cover-cta-row reveal reveal-5">
        <button
          className="btn btn-primary"
          onClick={() => document.getElementById('holdfast')?.scrollIntoView({ behavior: 'smooth' })}
        >
          Read the flagship
          <span className="btn-arrow">→</span>
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => document.getElementById('protocols')?.scrollIntoView({ behavior: 'smooth' })}
        >
          Index of protocols
        </button>
      </div>

      <CoverSeal/>
    </div>

    <footer className="cover-foot reveal reveal-6">
      <div className="cover-foot-cell">
        <span className="cover-foot-k">Flagship</span>
        <span className="cover-foot-v">Holdfast Protocol</span>
      </div>
      <div className="cover-foot-cell">
        <span className="cover-foot-k">Substrate</span>
        <span className="cover-foot-v">Solana · Rust</span>
      </div>
      <div className="cover-foot-cell">
        <span className="cover-foot-k">Posture</span>
        <span className="cover-foot-v">Verifiable, deterministic</span>
      </div>
      <div className="cover-foot-cell">
        <span className="cover-foot-k">Engagements</span>
        <span className="cover-foot-v">Selective</span>
      </div>
    </footer>
  </section>
);

/* ---------- §01 ABSTRACT (Mission) ---------- */
const Abstract = () => (
  <section id="abstract" className="section abstract" data-reveal>
    <span className="section-marker">§01 · Abstract</span>
    <span className="section-marker-r">Mission</span>

    <aside className="abstract-marg" aria-hidden="true">
      <div>Document § 01</div>
      <div className="abstract-marg-line">On purpose.</div>
      <div className="abstract-marg-line">On audience.</div>
      <div className="abstract-marg-line">On the moment.</div>
    </aside>

    <div className="abstract-body">
      <h2 className="abstract-h">
        We design <em>trust primitives</em>, deliberately.
      </h2>
      <p className="abstract-lede">
        <strong>Casemate Labs</strong> builds security-first protocols and software for identity, trust, autonomous systems, and digital asset control. We are not a product company. We are a small protocol laboratory that ships infrastructure other teams can build on.
      </p>
      <p className="abstract-lede">
        Our primitives make agents, applications, and counterparties easier to verify, govern, and trust. They are written specs-first, formally checked where it matters, and held to audit-grade gates before they leave the lab.
      </p>
    </div>

    <div className="abstract-articles">
      <div>
        <div className="abstract-article-num">§01.A</div>
        <h3 className="abstract-article-h">What we build</h3>
        <p className="abstract-article-b">
          Protocols for hardware-attested identity, programmable escrow, on-chain reputation, deterministic execution, and governance. Each piece is a minimum-surface primitive, designed to stand alone and to compose.
        </p>
      </div>
      <div>
        <div className="abstract-article-num">§01.B</div>
        <h3 className="abstract-article-h">Who it is for</h3>
        <p className="abstract-article-b">
          Teams shipping autonomous agents, on-chain markets, and verifiable software. When your counterparties are software and the stakes are real, the trust primitives have to be deliberate. We build the layer underneath.
        </p>
      </div>
      <div>
        <div className="abstract-article-num">§01.C</div>
        <h3 className="abstract-article-h">Why now</h3>
        <p className="abstract-article-b">
          Autonomous agents are starting to hold capital, sign contracts, and act on behalf of humans. Without verifiable identity, enforceable pacts, and durable reputation, that delegation collapses. We build what survives it.
        </p>
      </div>
    </div>
  </section>
);

/* ---------- §02 PROTOCOLS INDEX (Portfolio) ---------- */
const Protocols = () => {
  const jumpTo = (p) => {
    if (p.flagship) {
      document.getElementById('holdfast')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      // Hold the row briefly highlighted, no jump elsewhere — these are private.
    }
  };
  return (
    <section id="protocols" className="section protocols" data-reveal>
      <span className="section-marker">§02 · Index</span>
      <span className="section-marker-r">Portfolio</span>

      <header className="protocols-head">
        <h2 className="protocols-h">
          Index of <em>protocols</em>.
        </h2>
        <div className="protocols-meta">
          <div className="protocols-meta-row">
            <span className="protocols-meta-k">Entries</span>
            <span className="protocols-meta-v">VI</span>
          </div>
          <div className="protocols-meta-row">
            <span className="protocols-meta-k">Public</span>
            <span className="protocols-meta-v">II</span>
          </div>
          <div className="protocols-meta-row">
            <span className="protocols-meta-k">Private</span>
            <span className="protocols-meta-v">IV</span>
          </div>
        </div>
      </header>

      <div className="protocols-list" role="list">
        {PROTOCOLS.map(p => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className="protocol-row"
            onClick={() => jumpTo(p)}
          >
            <span className="protocol-roman">{p.roman}.</span>
            <span className="protocol-name">
              {p.name}
              {p.flagship && <span className="protocol-name-flagship">Flagship</span>}
            </span>
            <span className="protocol-desc">{p.desc}</span>
            <span className="protocol-stack">{p.stack}</span>
            <span className={`protocol-status ${p.status === 'PUBLIC' ? 'protocol-status-public' : 'protocol-status-private'}`}>
              {p.status}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

/* ---------- §03 HOLDFAST FEATURE ---------- */
const Feature = () => {
  const ascii =
`     AGENT                          COUNTERPARTY
       │                                  │
       │   ┌──────────────────────────┐   │
       ├──▶│  identity   (attested)   │◀──┤
       │   └──────────────────────────┘   │
       │   ┌──────────────────────────┐   │
       ├──▶│  escrow  (programmable)  │◀──┤
       │   └──────────────────────────┘   │
       │   ┌──────────────────────────┐   │
       └──▶│  reputation  (on-chain)  │◀──┘
           └──────────────┬───────────┘
                          │
                          ▼
                    ${'    '}HOLDFAST
                    ${'    '}PROTOCOL
                    ${'    '}· SOLANA ·`;

  return (
    <section id="holdfast" className="section feature" data-reveal>
      <span className="section-marker">§03 · Feature</span>
      <span className="section-marker-r">Flagship</span>

      <header className="feature-head">
        <span className="feature-eyebrow">
          <span className="feature-eyebrow-rule" aria-hidden="true"/>
          §03 · Flagship Protocol
        </span>
        <span className="feature-meta">Public · Pre-mainnet · Solana</span>
      </header>

      <h2 className="feature-title">
        Holdfast<br/>
        <em>Protocol</em><span className="feature-title-amp">.</span>
      </h2>

      <div className="feature-body-l">
        <div className="feature-prose">
          <p>
            <span className="dropcap">H</span>
            oldfast Protocol is <strong>trust infrastructure for autonomous AI agents on Solana</strong>. It combines hardware-attested identity, programmable escrow, and on-chain reputation so agents can prove who they are, enter enforceable pacts, and build a verifiable track record.
          </p>
          <p>
            The premise is straightforward. Software counterparties are starting to hold capital and sign contracts, but the rails they run on assume a human is behind every action. Without primitives that <em>verify the agent</em>, <em>enforce the pact</em>, and <em>remember the outcome</em>, delegation falls apart the moment it matters.
          </p>
          <p>
            Holdfast supplies those three primitives as a single composable layer. Identity is bound to verifiable hardware roots, not just keys. Escrow is held by an on-chain program with conditions both parties agreed to in advance. Reputation accrues from executed pacts — portable, verifiable, and impossible to launder.
          </p>

          <blockquote className="feature-pullquote">
            “Agents must be able to prove who they are, enter enforceable pacts, and carry a track record that travels with them.”
            <span className="feature-pullquote-attr">Casemate Labs · Holdfast Specification</span>
          </blockquote>

          <p>
            Holdfast is currently public and pre-mainnet. A companion SDK, <em>Holdfast Eliza</em>, brings the same primitives directly into the ElizaOS agent runtime so existing agent operators can adopt without changing their stack.
          </p>
        </div>
      </div>

      <aside className="feature-body-r">
        <div className="feature-spec">
          <div className="feature-spec-h">Specification</div>
          <div className="feature-spec-row"><span className="feature-spec-k">Substrate</span><span className="feature-spec-v">Solana</span></div>
          <div className="feature-spec-row"><span className="feature-spec-k">Language</span><span className="feature-spec-v">Rust</span></div>
          <div className="feature-spec-row"><span className="feature-spec-k">Primitives</span><span className="feature-spec-v">Identity · Escrow · Reputation</span></div>
          <div className="feature-spec-row"><span className="feature-spec-k">Status</span><span className="feature-spec-v">Public · Pre-mainnet</span></div>
          <div className="feature-spec-row"><span className="feature-spec-k">Companion</span><span className="feature-spec-v">Holdfast Eliza · SDK</span></div>
          <div className="feature-spec-row"><span className="feature-spec-k">Audit</span><span className="feature-spec-v">External · pre-release</span></div>
          <div className="feature-spec-row"><span className="feature-spec-k">Volume</span><span className="feature-spec-v">I · MMXXVI</span></div>
        </div>

        <div className="feature-ascii">
          <span className="feature-ascii-h">Architecture · Composition</span>
{ascii}
        </div>
      </aside>

      <div className="feature-pillars">
        <div>
          <span className="feature-pillar-roman">I.</span>
          <h3 className="feature-pillar-h"><em>Hardware-attested</em> identity</h3>
          <p className="feature-pillar-b">
            Agents bind to verifiable hardware roots so a counterparty can prove who, exactly, they are talking to. Not just a key with a name; an attested machine.
          </p>
        </div>
        <div>
          <span className="feature-pillar-roman">II.</span>
          <h3 className="feature-pillar-h"><em>Programmable</em> escrow</h3>
          <p className="feature-pillar-b">
            Pacts between agents are held in on-chain escrow with conditions both sides agreed to in advance. Settlement is mechanical, not negotiated.
          </p>
        </div>
        <div>
          <span className="feature-pillar-roman">III.</span>
          <h3 className="feature-pillar-h"><em>On-chain</em> reputation</h3>
          <p className="feature-pillar-b">
            Every executed pact contributes to a portable, verifiable track record. Agents earn the right to be trusted; bad actors cannot launder history.
          </p>
        </div>
      </div>
    </section>
  );
};

/* ---------- §04 DOCTRINE (Operating Principles) ---------- */
const Doctrine = () => (
  <section id="doctrine" className="section doctrine" data-reveal>
    <span className="section-marker">§04 · Doctrine</span>
    <span className="section-marker-r">Principles</span>

    <aside className="doctrine-side">
      <span className="doctrine-eyebrow">§04 · Six Articles</span>
      <h2 className="doctrine-h">
        Articles of <em>practice</em>.
      </h2>
      <p className="doctrine-note">
        We hold ourselves to a small number of principles. They are written down, applied to every protocol, and re-checked at every release.
      </p>
    </aside>

    <div className="doctrine-articles">
      {DOCTRINE.map((d) => (
        <article key={d.roman} className="doctrine-article">
          <span className="doctrine-article-roman">{d.roman}.</span>
          <div>
            <h3 className="doctrine-article-h">{d.t}</h3>
            <p className="doctrine-article-b">{d.b}</p>
          </div>
        </article>
      ))}
    </div>
  </section>
);

/* ---------- §05 ENGAGEMENT (Contact) ---------- */
const Engage = () => (
  <section id="engage" className="section engage" data-reveal>
    <span className="section-marker">§05 · Engagement</span>
    <span className="section-marker-r">Contact</span>

    <div className="engage-l">
      <span className="engage-eyebrow">§05 · Engagement</span>
      <h2 className="engage-h">
        For <em>correspondence</em>.
      </h2>
      <p className="engage-note">
        We work with teams building autonomous systems, on-chain markets, and verifiable software. If you need trust primitives, identity, escrow, or governance infrastructure, write to us directly.
      </p>
      <p className="engage-note">
        We accept a small number of briefs each cycle and respond to all of them, eventually.
      </p>
    </div>

    <div className="engage-r">
      <div className="engage-cards">
        <a className="engage-card" href="mailto:contact@casematelabs.com">
          <span className="engage-card-k">§ Direct</span>
          <span className="engage-card-v">contact@casematelabs.com</span>
          <span className="engage-card-meta">Briefs · Partnerships</span>
        </a>
        <a className="engage-card" href="mailto:holdfast@casematelabs.com">
          <span className="engage-card-k">§ Holdfast</span>
          <span className="engage-card-v">holdfast@casematelabs.com</span>
          <span className="engage-card-meta">Flagship enquiries</span>
        </a>
        <div className="engage-card engage-card-static">
          <span className="engage-card-k">§ Posture</span>
          <span className="engage-card-v">Selective engagement</span>
          <span className="engage-card-meta">Cycle · MMXXVI</span>
        </div>
      </div>
    </div>
  </section>
);

/* ---------- COLOPHON ---------- */
const Colophon = () => (
  <footer className="colophon" data-reveal>
    <div className="colophon-mark">Casemate Labs.</div>
    <div className="colophon-block">
      <span className="colophon-k">Volume</span>
      <span className="colophon-v">I · MMXXVI</span>
    </div>
    <div className="colophon-block">
      <span className="colophon-k">Typeset</span>
      <span className="colophon-v">Fraunces · JetBrains Mono</span>
    </div>
    <div className="colophon-block">
      <span className="colophon-k">Substrate</span>
      <span className="colophon-v">Solana · Rust · TypeScript</span>
    </div>
    <div className="colophon-foot">
      <span>© Casemate Labs · MMXXVI</span>
      <span>Trust infrastructure for the autonomous web.</span>
      <span>End / Vol. I</span>
    </div>
  </footer>
);

/* ---------- APP ---------- */
function App() {
  const active = useActiveChapter();
  useReveal();
  return (
    <>
      <DocBar/>
      <ChapterIndex active={active}/>
      <main>
        <Cover/>
        <Abstract/>
        <Protocols/>
        <Feature/>
        <Doctrine/>
        <Engage/>
      </main>
      <Colophon/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
