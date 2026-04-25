# Holdfast Video Component Library

Reusable Remotion components for Holdfast Protocol video production.
All components live under `src/components/` and consume constants from `src/brand.ts`.

---

## Brand Constants — `src/brand.ts`

Single source of truth for all design tokens.

| Export | Purpose |
|--------|---------|
| `COLORS` | Full palette (bg, text, accent, hardline, status) |
| `FONTS` | Font family, weights, and a size scale |
| `LOGO` | Logo size presets (small / medium / large / hero) |
| `VIDEO` | `fps: 30`, `width: 1920`, `height: 1080` |
| `EASING` | Named Bezier curves (`entrance`, `spring`, `smooth`) |
| `TRANSITION_FRAMES` | Standard transition length (15 frames) |

`src/theme.ts` re-exports `COLORS` as `THEME` and the video constants for backward compat.
New compositions should import from `brand.ts` directly.

---

## Animation Helpers — `src/components/AnimUtils.ts`

Thin wrappers around Remotion's `interpolate` that apply brand easings.

```ts
import { fadeIn, slideIn, springScale, pulse } from "./AnimUtils";

// opacity 0→1 starting at frame 30 over 18 frames
const opacity = fadeIn(frame, 30, 18);

// y-offset 40→0, same timing
const y = slideIn(frame, 30, 18, 40);

// scale 0→1 with overshoot spring
const scale = springScale(frame, 0, fps * 1);

// oscillating value for glow/breathing effects
const glow = pulse(frame, fps * 4, 0.3, 0.8);
```

---

## IntroScene — `src/components/IntroScene.tsx`

Branded opening card. Renders: logo → eyebrow label → title → subtitle.

**Props**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Main headline |
| `subtitle` | `string?` | — | Secondary line below title |
| `eyebrow` | `string?` | — | Small all-caps label above title |
| `accentColor` | `string?` | `COLORS.accent` | Glow and eyebrow colour |

**Timing** (at 30 fps)

| Element | Appears at |
|---------|-----------|
| Logo | Frame 0 (spring scale) |
| Eyebrow | Frame 24 |
| Title | Frame 36 |
| Subtitle | Frame 60 |

**Example**

```tsx
<IntroScene
  eyebrow="Holdfast Protocol"
  title="What is Holdfast Protocol?"
  subtitle="Trust infrastructure for autonomous AI agents on Solana"
/>
```

Recommended duration: **150–210 frames (5–7 s)** at 30 fps.

---

## OutroScene — `src/components/OutroScene.tsx`

Branded end card. Renders: logo wordmark → tagline → CTA buttons → attribution.

**Props**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `primaryCta` | `string?` | `"Explore the SDK"` | Primary button label |
| `secondaryCta` | `string?` | `"Join Devnet"` | Secondary button label |
| `tagline` | `string?` | — | Short sentence above buttons |
| `accentColor` | `string?` | `COLORS.accent` | Glow and primary button colour |

**Example**

```tsx
<OutroScene
  tagline="Trust infrastructure for the autonomous economy"
  primaryCta="Read the docs"
  secondaryCta="Join devnet"
/>
```

Recommended duration: **210–300 frames (7–10 s)** at 30 fps.

---

## SectionDivider — `src/components/SectionDivider.tsx`

Short animated break between major sections. Renders an accent line sweep, optional section number, label, and optional description.

**Props**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | required | Section name |
| `sectionNumber` | `number?` | — | Shown as zero-padded prefix (01, 02 …) |
| `accentColor` | `string?` | `COLORS.accent` | Line and number colour |
| `description` | `string?` | — | One-line context below the label |

**Example**

```tsx
<SectionDivider
  sectionNumber={2}
  label="The Solution"
  description="Three primitives that make AI-agent commerce safe"
  accentColor={COLORS.success}
/>
```

Recommended duration: **90–120 frames (3–4 s)** at 30 fps.

---

## LogoMark — `src/components/LogoMark.tsx`

SVG logo asset. Two variants: shield mark only, or shield + wordmark.

**Props**

| Prop | Type | Default |
|------|------|---------|
| `size` | `number` | `160` |
| `color` | `string` | `COLORS.accent` |
| `showWordmark` | `boolean` | `false` |

**Example**

```tsx
<LogoMark size={80} />                    // mark only
<LogoMark size={200} showWordmark />      // full wordmark
```

---

## VideoTemplate — `src/templates/VideoTemplate.tsx`

Base wrapper that sequences IntroScene → body scenes → OutroScene with fade transitions.

**Props**

| Prop | Type |
|------|------|
| `intro` | `IntroSceneProps` |
| `outro` | `OutroSceneProps?` |
| `scenes` | `Array<{ component: React.FC, durationInFrames: number }>` |

**Helper**

```ts
import { calcTemplateDuration } from "./templates/VideoTemplate";

const duration = calcTemplateDuration([fps * 14, fps * 14, fps * 24]);
// → total frames accounting for intro, outro, and all transitions
```

**Registering in Root.tsx**

```tsx
import { VideoTemplate, calcTemplateDuration } from "./templates/VideoTemplate";

const MY_VIDEO_SCENES = [MyScene1, MyScene2];
const MY_SCENE_DURATIONS = [fps * 14, fps * 16];

<Composition
  id="MyVideo"
  component={() => (
    <VideoTemplate
      intro={{ title: "My Video", eyebrow: "Holdfast Protocol" }}
      scenes={MY_VIDEO_SCENES.map((c, i) => ({
        component: c,
        durationInFrames: MY_SCENE_DURATIONS[i],
      }))}
    />
  )}
  durationInFrames={calcTemplateDuration(MY_SCENE_DURATIONS)}
  fps={VIDEO.fps}
  width={VIDEO.width}
  height={VIDEO.height}
/>
```

---

## TemplatePreview composition

Open Remotion Studio (`npm run dev`) and select **TemplatePreview** to see
IntroScene → SectionDivider → OutroScene rendered back-to-back.
Use this to verify component styling changes before building a full video.

---

## Adding a new video

1. Create a folder `src/scenes/<video-name>/` for your scene files.
2. Create a top-level `src/<VideoName>.tsx` that uses `VideoTemplate` (or `TransitionSeries` manually).
3. Register a `<Composition>` in `Root.tsx`.
4. Add a render script to `package.json`:
   ```json
   "render:<name>": "remotion render <VideoName> out/<name>.mp4"
   ```
