const { useState, useEffect, useMemo } = React;

// --- DATA ---
const PROJECTS = [
  {
    name: 'Holdfast Protocol',
    description: 'Institutional-grade trust infrastructure for autonomous AI agents.',
    tags: ['Solana', 'AI Agents', 'Escrow'],
    glyph: 'shield',
    status: 'Public',
  },
  {
    name: 'DeterminOS',
    description: 'Deterministic execution environments for verifiable compute operations.',
    tags: ['Core OS', 'TypeScript'],
    glyph: 'cpu',
    status: 'Private',
  },
  {
    name: 'EdictProtocol',
    description: 'Decentralized rules engine and smart contract governance primitives.',
    tags: ['JavaScript', 'Smart Contracts'],
    glyph: 'layers',
    status: 'Private',
  },
  {
    name: 'ProofRelay',
    description: 'High-performance cryptographic proof verification and relay network.',
    tags: ['TypeScript', 'Cryptography'],
    glyph: 'terminal',
    status: 'Private',
  },
  {
    name: 'Holdfast Eliza',
    description: 'ElizaOS plugin bridging Holdfast Protocol with AI agent ecosystems.',
    tags: ['ElizaOS', 'Plugin'],
    glyph: 'code',
    status: 'Public',
  },
  {
    name: 'HardlineProtocol',
    description: 'Immutable security layers and fail-safes for decentralized applications.',
    tags: ['Security', 'Protocol'],
    glyph: 'globe',
    status: 'Private',
  },
];

// --- ICONS (lucide-style, hand-rolled minimal SVG strokes) ---
const Icon = ({ name, className = 'w-4 h-4', stroke = 'currentColor' }) => {
  const paths = {
    terminal: <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></>,
    code: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>,
    globe: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    arrow: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    github: <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>,
    twitter: <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>,
    mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></>,
    pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    dot: <circle cx="12" cy="12" r="3"/>,
    chev: <polyline points="9 18 15 12 9 6"/>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name]}
    </svg>
  );
};

// --- SMALL UI ATOMS ---
const StatusPill = ({ status }) => {
  if (status === 'Public') {
    return (
      <span className="status-pill status-public">
        <span className="status-dot" />
        Public
      </span>
    );
  }
  return (
    <span className="status-pill status-private">
      <span className="status-dot" />
      Private
    </span>
  );
};

const Tag = ({ children }) => (
  <span className="tag">{children}</span>
);

// --- CARDS ---
const ProjectCard = ({ project, density }) => {
  const padCls = density === 'compact' ? 'p-6' : 'p-8';
  const gapCls = density === 'compact' ? 'mb-7' : 'mb-12';
  return (
    <div className={`project-card group ${padCls}`}>
      <div className="card-glow" />
      <div className="relative z-10 flex flex-col h-full">
        <div className={`flex justify-between items-start ${gapCls}`}>
          <div className="icon-tile">
            <Icon name={project.glyph} className="w-5 h-5" />
          </div>
          <StatusPill status={project.status} />
        </div>
        <h3 className="card-title">{project.name}</h3>
        <p className="card-desc">{project.description}</p>
        <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
          {project.tags.map((t) => <Tag key={t}>{t}</Tag>)}
        </div>
      </div>
      <div className="card-corner-arrow">
        <Icon name="arrow" className="w-3.5 h-3.5" />
      </div>
    </div>
  );
};

// --- HERO VARIANTS ---
const HeroClassic = () => (
  <div className="flex flex-col items-start max-w-4xl">
    <div className="locator-pill">
      <Icon name="pin" className="w-3.5 h-3.5" stroke="var(--zinc-500)" />
      <span>Hailing from Newcastle. Deployed globally.</span>
    </div>
    <h1 className="hero-headline">
      Institutional grade <br />
      <span className="hero-headline-muted">trust infrastructure.</span>
    </h1>
    <p className="hero-sub">
      We engineer deterministically secure protocols, autonomous agent frameworks, and high-performance decentralized systems on Solana.
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn-primary group">
        Explore Ecosystem
        <Icon name="arrow" className="w-4 h-4 btn-arrow" />
      </button>
      <button className="btn-secondary">
        <Icon name="github" className="w-4 h-4" />
        View Source
      </button>
    </div>
  </div>
);

const HeroSplit = () => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end">
    <div className="lg:col-span-7">
      <div className="locator-pill">
        <Icon name="pin" className="w-3.5 h-3.5" stroke="var(--zinc-500)" />
        <span>Newcastle → Global</span>
      </div>
      <h1 className="hero-headline hero-headline-split">
        Institutional grade<br/>
        <span className="hero-headline-muted">trust</span>{' '}
        <span className="hero-accent">infra</span>
        <span className="hero-headline-muted">structure.</span>
      </h1>
      <div className="flex flex-wrap items-center gap-3 mt-10">
        <button className="btn-primary group">
          Explore Ecosystem
          <Icon name="arrow" className="w-4 h-4 btn-arrow" />
        </button>
        <button className="btn-secondary">
          <Icon name="github" className="w-4 h-4" />
          View Source
        </button>
      </div>
    </div>
    <div className="lg:col-span-5">
      <div className="hero-side-panel">
        <div className="hero-side-row">
          <span className="hero-side-key">Discipline</span>
          <span className="hero-side-val">Cryptographic systems</span>
        </div>
        <div className="hero-side-row">
          <span className="hero-side-key">Substrate</span>
          <span className="hero-side-val">Solana · TypeScript · Rust</span>
        </div>
        <div className="hero-side-row">
          <span className="hero-side-key">Posture</span>
          <span className="hero-side-val">Deterministic, verifiable</span>
        </div>
        <div className="hero-side-row">
          <span className="hero-side-key">Status</span>
          <span className="hero-side-val">
            <span className="status-dot status-dot-live" /> Operating
          </span>
        </div>
        <p className="hero-side-blurb">
          We engineer deterministically secure protocols, autonomous agent frameworks, and high-performance decentralized systems.
        </p>
      </div>
    </div>
  </div>
);

const HeroTerminal = () => (
  <div className="flex flex-col items-start max-w-4xl">
    <div className="terminal-window">
      <div className="terminal-bar">
        <span className="t-dot" /><span className="t-dot" /><span className="t-dot" />
        <span className="terminal-title">~/casemate · sh</span>
      </div>
      <div className="terminal-body">
        <div><span className="t-prompt">casemate</span> <span className="t-path">~</span> <span className="t-caret">$</span> whoami</div>
        <div className="t-out">Casemate Labs · Newcastle, UK</div>
        <div><span className="t-prompt">casemate</span> <span className="t-path">~</span> <span className="t-caret">$</span> cat MISSION</div>
        <div className="t-out">Engineering deterministically secure protocols,</div>
        <div className="t-out">autonomous agent frameworks, and high-performance</div>
        <div className="t-out">decentralized systems on Solana.</div>
        <div><span className="t-prompt">casemate</span> <span className="t-path">~</span> <span className="t-caret">$</span> <span className="t-cursor">▍</span></div>
      </div>
    </div>
    <h1 className="hero-headline mt-12">
      Institutional grade <br />
      <span className="hero-headline-muted">trust infrastructure.</span>
    </h1>
    <div className="flex flex-wrap items-center gap-3 mt-10">
      <button className="btn-primary group">
        Explore Ecosystem
        <Icon name="arrow" className="w-4 h-4 btn-arrow" />
      </button>
      <button className="btn-secondary">
        <Icon name="github" className="w-4 h-4" />
        View Source
      </button>
    </div>
  </div>
);

// --- PAGE ---
function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "graphite",
    "density": "comfy",
    "hero": "classic",
    "filter": "all",
    "showGrain": true,
    "showAurora": true
  }/*EDITMODE-END*/;

  const [tweaks, setTweak] = (window.useTweaks || (() => [TWEAK_DEFAULTS, () => {}]))(TWEAK_DEFAULTS);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Apply accent color to root
  useEffect(() => {
    const accentMap = {
      graphite: { hue: 'oklch(0.92 0.005 250)', soft: 'oklch(0.55 0.01 250)' },
      sodium:   { hue: 'oklch(0.85 0.14 75)',   soft: 'oklch(0.62 0.10 75)' },
      lichen:   { hue: 'oklch(0.82 0.11 145)',  soft: 'oklch(0.58 0.08 145)' },
      cobalt:   { hue: 'oklch(0.78 0.13 240)',  soft: 'oklch(0.55 0.10 240)' },
      magenta:  { hue: 'oklch(0.78 0.16 340)',  soft: 'oklch(0.55 0.11 340)' },
    };
    const a = accentMap[tweaks.accent] || accentMap.graphite;
    document.documentElement.style.setProperty('--accent', a.hue);
    document.documentElement.style.setProperty('--accent-soft', a.soft);
  }, [tweaks.accent]);

  const filtered = useMemo(() => {
    if (tweaks.filter === 'public')  return PROJECTS.filter(p => p.status === 'Public');
    if (tweaks.filter === 'private') return PROJECTS.filter(p => p.status === 'Private');
    return PROJECTS;
  }, [tweaks.filter]);

  const heroEl =
    tweaks.hero === 'split' ? <HeroSplit/> :
    tweaks.hero === 'terminal' ? <HeroTerminal/> :
    <HeroClassic/>;

  return (
    <div className="page">
      {/* BG */}
      <div className="bg-fx">
        {tweaks.showAurora && <div className="aurora" />}
        {tweaks.showGrain && <div className="grain" />}
        <div className="vignette" />
      </div>

      {/* NAV */}
      <nav className={`nav ${scrolled ? 'nav-scrolled' : ''}`}>
        <div className="nav-inner">
          <a href="#top" className="brand">
            <div className="brand-mark">
              <Icon name="terminal" className="w-4 h-4" />
            </div>
            <span className="brand-name">Casemate<span className="brand-name-dim">Labs</span></span>
          </a>
          <div className="nav-links">
            <a href="#about" className="nav-link">Vision</a>
            <a href="#projects" className="nav-link">Infrastructure</a>
            <a href="#contact" className="nav-cta">Engage</a>
          </div>
        </div>
      </nav>

      <main className="main">
        {/* HERO */}
        <section className="container hero-section">
          {heroEl}
          {/* signal strip */}
          <div className="signal-strip">
            <div className="signal-item">
              <span className="signal-num">6</span>
              <span className="signal-key">Active protocols</span>
            </div>
            <div className="signal-divider" />
            <div className="signal-item">
              <span className="signal-num">2</span>
              <span className="signal-key">Public deployments</span>
            </div>
            <div className="signal-divider" />
            <div className="signal-item">
              <span className="signal-num">99.99<span className="signal-unit">%</span></span>
              <span className="signal-key">Mainnet uptime</span>
            </div>
            <div className="signal-divider" />
            <div className="signal-item">
              <span className="signal-num">∞</span>
              <span className="signal-key">Determinism</span>
            </div>
          </div>
        </section>

        {/* PROJECTS */}
        <section id="projects" className="container projects-section">
          <div className="section-head">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-bullet" />
                Section · 02
              </div>
              <h2 className="section-title">Core Infrastructure</h2>
              <p className="section-sub">
                A suite of private research and public protocols powering the next generation of autonomous networks.
              </p>
            </div>
            <div className="section-meta">
              <div className="filter-row">
                {['all','public','private'].map(k => (
                  <button
                    key={k}
                    onClick={() => setTweak('filter', k)}
                    className={`filter-btn ${tweaks.filter === k ? 'filter-btn-active' : ''}`}
                  >
                    {k === 'all' ? 'All' : k[0].toUpperCase()+k.slice(1)}
                  </button>
                ))}
              </div>
              <div className="stack">
                <span>TypeScript</span><span className="sep">/</span>
                <span>Rust</span><span className="sep">/</span>
                <span>Solana</span>
              </div>
            </div>
          </div>

          <div className="project-grid">
            {filtered.map((p) => (
              <ProjectCard key={p.name} project={p} density={tweaks.density} />
            ))}
          </div>
        </section>

        {/* CTA */}
        <section id="contact" className="container cta-section">
          <div className="cta-card">
            <div className="cta-topline" />
            <div className="cta-eyebrow">
              <Icon name="dot" className="w-2 h-2 cta-eyebrow-dot"/>
              Engagements open · Q2 2026
            </div>
            <h2 className="cta-title">Accelerate your vision.</h2>
            <p className="cta-sub">
              Partner with Casemate Labs to integrate enterprise-grade trust and execution environments into your systems.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button className="btn-primary cta-btn">
                Initiate Contact
                <Icon name="arrow" className="w-4 h-4 btn-arrow"/>
              </button>
              <button className="btn-secondary">
                Read whitepaper
              </button>
            </div>
            <div className="cta-grid-bg" aria-hidden="true" />
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container footer-inner">
          <div className="brand">
            <Icon name="terminal" className="w-3.5 h-3.5" />
            <span className="brand-name brand-name-sm">Casemate<span className="brand-name-dim">Labs</span></span>
          </div>
          <p className="footer-copy">© 2026 Casemate Labs. All rights reserved.</p>
          <div className="footer-socials">
            <a href="#" className="social"><Icon name="twitter" className="w-4 h-4" /></a>
            <a href="#" className="social"><Icon name="github" className="w-4 h-4" /></a>
            <a href="#" className="social"><Icon name="mail" className="w-4 h-4" /></a>
          </div>
        </div>
      </footer>

      {/* TWEAKS PANEL */}
      {window.TweaksPanel && (
        <window.TweaksPanel title="Tweaks" subtitle="Casemate Labs">
          <window.TweakSection title="Identity">
            <window.TweakSelect
              label="Accent"
              value={tweaks.accent}
              onChange={(v) => setTweak('accent', v)}
              options={[
                { value: 'graphite', label: 'Graphite (default)' },
                { value: 'sodium',   label: 'Sodium amber' },
                { value: 'lichen',   label: 'Lichen green' },
                { value: 'cobalt',   label: 'Cobalt blue' },
                { value: 'magenta',  label: 'Plasma magenta' },
              ]}
            />
          </window.TweakSection>

          <window.TweakSection title="Hero layout">
            <window.TweakRadio
              value={tweaks.hero}
              onChange={(v) => setTweak('hero', v)}
              options={[
                { value: 'classic',  label: 'Classic' },
                { value: 'split',    label: 'Split spec' },
                { value: 'terminal', label: 'Terminal' },
              ]}
            />
          </window.TweakSection>

          <window.TweakSection title="Cards">
            <window.TweakRadio
              label="Density"
              value={tweaks.density}
              onChange={(v) => setTweak('density', v)}
              options={[
                { value: 'comfy',   label: 'Comfy' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
            <window.TweakRadio
              label="Filter"
              value={tweaks.filter}
              onChange={(v) => setTweak('filter', v)}
              options={[
                { value: 'all',     label: 'All' },
                { value: 'public',  label: 'Public' },
                { value: 'private', label: 'Private' },
              ]}
            />
          </window.TweakSection>

          <window.TweakSection title="Atmosphere">
            <window.TweakToggle
              label="Aurora glow"
              value={tweaks.showAurora}
              onChange={(v) => setTweak('showAurora', v)}
            />
            <window.TweakToggle
              label="Film grain"
              value={tweaks.showGrain}
              onChange={(v) => setTweak('showGrain', v)}
            />
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
