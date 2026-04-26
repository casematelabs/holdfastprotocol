## UX Health Snapshot — 2026-04-26

Overall rating: **Degraded** — 4 high/critical findings, 4 medium design debt items.

---

### Critical

**C1 · Misleading "Mainnet Beta Live" badge**
The hero section announces "Solana Mainnet Beta Live" with a pulsing green dot. However, the SDK version is `0.2.0-devnet.2`, all docs reference devnet, and the devnet launch write-up is the latest milestone. Showing "Mainnet" is factually wrong and will mislead developers evaluating the protocol. Should read "Devnet Live" or "Devnet Beta" until mainnet launch.

---

### High

**H1 · No mobile navigation menu**
`app/page.tsx:27` hides nav links with `hidden md:flex` on small screens with no hamburger menu or drawer to replace them. Mobile users cannot reach Protocol, Developers, Documentation, or Network Status sections. Only the CTA ("Start Building") is accessible on mobile.

**H2 · Footer social links are broken placeholders**
`app/page.tsx:289–306` — Twitter, GitHub, and Discord all use `href="#"`. These are the only community discovery links in the entire site. Broken links erode trust, especially for a protocol marketing itself on trustworthiness.

**H3 · Safari pinned-tab icon uses wrong brand color**
`app/layout.tsx:39` — `mask-icon` color is `#2D8CFF` (blue), while the brand primary is emerald green (`#10b981`). The pinned tab will show a blue icon inconsistent with every other branded surface.

---

### Medium (Design Debt)

**M1 · Color system divergence: wireframes vs. live site**
Wireframes (`hol-124-onboarding-dashboard.html`, `design-tokens.html`) define `--accent: #2D8CFF` (blue) as primary. The live site uses emerald as primary (`#10b981`) with blue only on status badges. If wireframes drive future feature implementation, this drift will ship visual inconsistency. Recommend updating wireframes to match live system or explicitly documenting the color split.

**M2 · Purple not a first-class design token**
Purple (`#a855f7`) is used for Layer 3 / Trust/Reputation in `page.tsx` and `app/docs/page.tsx`, but it is not registered as a CSS variable in `globals.css`. Only emerald, cyan, and the accent surface colors are tokenised. Purple applied inline is hard to update consistently.

**M3 · Onboarding page uses inline styles instead of Tailwind**
`app/onboarding/page.tsx` uses `style={{}}` object literals throughout, while every other page uses Tailwind utility classes. This splits the maintenance pattern — hover/focus states, media queries, and dark-mode toggling are all harder to manage in inline styles. Recommend migrating to Tailwind to match the codebase convention.

**M4 · Dashboard cold-start is a silent blank redirect**
`app/dashboard/page.tsx` calls `redirect('/dashboard/reputation')` with no loading indicator. On slow connections this renders a blank white flash before the redirect resolves. A loading skeleton or an immediate layout render would be smoother.

---

### Low / Accessibility

**A1 · No skip-to-main-content link**
WCAG 2.1 SC 2.4.1 (AA) recommends a skip link as the first focusable element so keyboard and screen reader users can bypass repeated navigation. Not present on any page.

**A2 · Animated status dot has no ARIA label**
`app/page.tsx:68` — the decorative pulsing dot in the hero badge lacks `aria-hidden="true"`, so screen readers may announce it as unnamed content.

**A3 · Focus CSS bypassed in onboarding inline styles**
`globals.css:49–62` implements proper `:focus-visible` for all interactive elements. The onboarding page's inline-styled buttons won't inherit these rules, creating potential focus visibility gaps in the most conversion-critical flow.

---

### What's Working Well

- `globals.css` has solid `prefers-reduced-motion` support — all animations disabled at OS level
- `:focus-visible` is implemented correctly (not `:focus`) on Tailwind pages
- SEO metadata in `layout.tsx` is comprehensive — Open Graph, Twitter Card, schema.org org + product, canonical URL
- Color palette is cohesive and high-contrast; slate-400 on slate-950 passes WCAG AA for body copy
- 3-step developer onboarding layout tells a clear story; CodePreview component is well-executed

---

### Recommended Next Actions

| Priority | Action |
|---|---|
| Critical | Fix hero badge: `Solana Mainnet Beta Live` → `Solana Devnet Beta` |
| High | Add mobile hamburger/drawer for main nav |
| High | Replace `href="#"` footer links with real social URLs |
| High | Fix `mask-icon` color: `#2D8CFF` → `#10b981` in `layout.tsx:39` |
| Medium | Register `--color-purple` as CSS design token in `globals.css` |
| Medium | Migrate onboarding inline styles to Tailwind |
| Low | Add skip-to-main-content link in root layout |
| Low | Add `aria-hidden="true"` to decorative pulse dot in hero |
