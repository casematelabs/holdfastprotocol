# Holdfast Remotion Environment

This package contains the Remotion project used to produce Holdfast protocol videos.

## Prerequisites

- Node.js 20+ (tested in this repository with Node.js 24.15.0)
- npm

## Setup

```bash
cd video
npm install
```

## Commands

```bash
# Start Remotion Studio (interactive preview)
npm run dev

# Lint + TypeScript checks
npm run lint

# Bundle the Remotion project for production renders
npm run build

# Render all shipping compositions to MP4
npm run render

# Render one composition
npm run render:pitch
npm run render:demo
```

Rendered files are written to `video/out/`.

## Compositions

- `HoldfastPitch` -> `out/holdfast-pitch.mp4`
- `HoldfastDemo` -> `out/holdfast-demo.mp4`

## Versioning Note

Keep all Remotion packages on the exact same version. If versions drift, Remotion may warn about package mismatch and produce unstable renders.
