# Lugo Studio V3: Palette and Style Guide

Desktop app built with Electron. Brand direction: pitch green on neutral surfaces with a slight green tint. Dark mode is the default. Light mode is the alternative. A sample page with all of this applied is `lugo-studio-v3-style-sample.html`.

**Default color palette id:** `default` (pitch green). Set on `<html>` as `data-palette="default"`. Appearance is `data-theme="dark" | "light"`.

## Rules for implementation

- Use CSS custom properties only. Never hardcode a hex value in a component.
- Theme is set with `data-theme="dark" | "light"` on `<html>`.
- Palette is set with `data-palette="<id>"` on `<html>` (today always `default`).
- Every color below exists in both themes. Add new tokens to both themes for every shipped palette.
- Components bind only to **semantic** token names (`--bg-base`, `--primary`, …), never to palette-specific hexes.
- Color is never the only signal for status or team identity. Pair it with an icon, shape, or text.

## Color tokens (palette: `default`)

### Surfaces and text

| Token | Dark | Light |
|---|---|---|
| `--bg-base` (app background) | `#0F1412` | `#F4F7F5` |
| `--bg-surface` (panels, sidebar, title bar) | `#161C1A` | `#FFFFFF` |
| `--bg-elevated` (menus, dialogs) | `#1E2623` | `#FFFFFF` |
| `--bg-hover` | `#26302C` | `#E8EEEB` |
| `--bg-selected` | `#1F3A2C` | `#DCEFE3` |
| `--border` | `#2A3430` | `#D5DDD9` |
| `--border-strong` | `#3B4843` | `#B6C2BC` |
| `--text` (primary) | `#E6EDEA` | `#14201B` |
| `--text-2` (secondary) | `#9AA8A2` | `#4F5F58` |
| `--text-disabled` | `#5F6B66` | `#94A39C` |

### Brand and status

| Token | Dark | Light |
|---|---|---|
| `--primary` | `#34D27B` | `#15803D` |
| `--primary-hover` | `#5BE39A` | `#166534` |
| `--primary-active` | `#26B666` | `#14532D` |
| `--on-primary` (text on primary) | `#06140D` | `#FFFFFF` |
| `--info` | `#60A5FA` | `#1D4ED8` |
| `--success` | `#4ADE80` | `#15803D` |
| `--warning` | `#FBBF24` | `#B45309` |
| `--error` | `#F87171` | `#B91C1C` |
| `--focus` (focus ring) | `#60A5FA` | `#1D4ED8` |

### Simulation

Blue versus orange stays distinguishable for color-blind users.

| Token | Dark | Light |
|---|---|---|
| `--team-home` | `#3B82F6` | `#2563EB` |
| `--team-away` | `#FB923C` | `#EA580C` |
| `--ball` | `#FAFAFA` | `#FAFAFA` (add a dark outline) |
| `--pitch` | `#14532D` | `#2F9E5B` |
| `--pitch-lines` | `rgba(230,237,234,.7)` | `rgba(255,255,255,.9)` |

Team identity also uses shape: home is a circle, away is a rounded square.

### CSS (default palette)

```css
:root[data-palette="default"][data-theme="dark"] {
  color-scheme: dark;
  --bg-base:#0F1412; --bg-surface:#161C1A; --bg-elevated:#1E2623;
  --bg-hover:#26302C; --bg-selected:#1F3A2C;
  --border:#2A3430; --border-strong:#3B4843;
  --text:#E6EDEA; --text-2:#9AA8A2; --text-disabled:#5F6B66;
  --primary:#34D27B; --primary-hover:#5BE39A; --primary-active:#26B666; --on-primary:#06140D;
  --info:#60A5FA; --success:#4ADE80; --warning:#FBBF24; --error:#F87171; --focus:#60A5FA;
  --team-home:#3B82F6; --team-away:#FB923C; --ball:#FAFAFA;
  --pitch:#14532D; --pitch-lines:rgba(230,237,234,.7);
}
:root[data-palette="default"][data-theme="light"] {
  color-scheme: light;
  --bg-base:#F4F7F5; --bg-surface:#FFFFFF; --bg-elevated:#FFFFFF;
  --bg-hover:#E8EEEB; --bg-selected:#DCEFE3;
  --border:#D5DDD9; --border-strong:#B6C2BC;
  --text:#14201B; --text-2:#4F5F58; --text-disabled:#94A39C;
  --primary:#15803D; --primary-hover:#166534; --primary-active:#14532D; --on-primary:#FFFFFF;
  --info:#1D4ED8; --success:#15803D; --warning:#B45309; --error:#B91C1C; --focus:#1D4ED8;
  --team-home:#2563EB; --team-away:#EA580C; --ball:#FAFAFA;
  --pitch:#2F9E5B; --pitch-lines:rgba(255,255,255,.9);
}
```

## Adding another color palette (future)

Studio ships only the `default` palette today. There is no Settings palette picker yet.

To add a palette later without renaming UI contracts:

1. Keep every semantic token name unchanged (`--bg-base`, `--primary`, status, simulation, …).
2. Add dark and light value tables under `:root[data-palette="<new-id>"][data-theme="…"]`.
3. Document both tables in this guide.
4. A future Settings control may set `data-palette` on `<html>` (and persist it). Components must not care which palette is active.

Do not invent a second hard-coded brand color set inside components.

## Typography

- UI font: Inter, fallback `system-ui, "Segoe UI", sans-serif`.
- Code and logs: JetBrains Mono, fallback `ui-monospace, Menlo, Consolas, monospace`.
- Bundle both fonts with the app. Do not load them from a CDN in production.
- Scale (px): 11 labels, 12 secondary, **13 base**, 14 inputs, 16 section titles, 20 page titles.
- Weights: 400 body, 500 buttons and labels, 600 titles. Avoid 700 and above.

## Spacing and shape

- 4px grid: 4, 8, 12, 16, 24, 32.
- Radius: 4 (inputs, buttons), 6 (cards), 8 (dialogs).
- Panels are separated by 1px borders, not shadows.
- Shadows only for floating elements: menus, dialogs, toasts.

## Components

| Component | Spec |
|---|---|
| Primary button | `--primary` fill, `--on-primary` text. Hover and active use the matching tokens. One per view. |
| Secondary button | Transparent, 1px `--border-strong` outline, `--text` label. |
| Destructive button | `--error` text and outline. Filled `--error` only inside confirmation dialogs. |
| Disabled button | `--text-disabled` text, `--border` outline, no fill. |
| Input | `--bg-surface` fill, 1px `--border`. Placeholder uses `--text-disabled`. |
| Focus state | 2px `--focus` outline with 1px offset, on every interactive element. |
| Sidebar item | `--text-2` label. Hover `--bg-hover`. Selected `--bg-selected` with `--text`. |
| Status chip | Background is the status color at 15% (`color-mix(in srgb, var(--c) 15%, transparent)`), label in the status color, plus an icon. |
| Dialog | `--bg-elevated`, 1px `--border-strong`, radius 8, shadow. Cancel on the left, confirm on the right. |
| Console and logs | JetBrains Mono 12px. Timestamps `--text-2`, INFO `--info`, WARN `--warning`, ERROR `--error`. |

### Forms

- Label above the field, 11–12px, weight 500, `--text-2`.
- Helper text under the field uses `--text-2` at 12px.
- Error text under the field uses `--error` at 12px; pair with an icon or the word “Error” when needed.
- Group related fields with 16px vertical gap; section titles 16px / weight 600.
- Prefer one primary submit per form view.

### Dialogs

- Backdrop dims the shell; dialog uses `--bg-elevated`, 1px `--border-strong`, radius 8, and a soft shadow.
- Order: title (16–20px, weight 600) → body (`--text-2`) → optional input → actions.
- Actions: Cancel (secondary) on the left, confirm (primary or destructive) on the right.
- Prompt dialogs use the shared input recipe; Enter confirms when safe.

### Notices / toasts

- Non-blocking, stacked bottom-right.
- High-visibility treatment from status/brand tokens (for example warning fill at ~15% mix + `--warning` border/label), not one-off hexes.
- Auto-dismiss after 5 seconds with a countdown bar; manual dismiss still available.

### Full-screen gates (loading / error)

- Fill the window with `--bg-base` (not a separate legacy teal).
- Title/status use `--text`; detail and secondary copy use `--text-2`.
- Progress track uses `--border` / `--bg-surface`; fill uses `--primary`.
- Logs use JetBrains Mono 12px on a `--bg-surface` panel with `--border`.
- Error retry is a primary or secondary button per hierarchy rules.
- Keep waiting-robot / broken-robot imagery and step progress content.

### Button hierarchy usage

- One primary action per view or dialog.
- Secondary for cancel / alternate paths.
- Destructive outline for dangerous actions; filled destructive only inside a confirmation dialog.

## Electron specifics

- Dark is the product default today. Light is selectable in Settings. A future Light / Dark / System preference may follow OS via `nativeTheme.shouldUseDarkColors`.
- Set `data-theme` and `data-palette` on `<html>` before first paint to avoid a flash. Set `BrowserWindow` `backgroundColor` to the active theme’s `--bg-base`.
- Custom title bar: `-webkit-app-region: drag` on the bar, `no-drag` on its buttons. Use `--bg-surface` with a 1px `--border` bottom edge.
- Desktop feel: `user-select: none` on app chrome. Allow selection only in code, logs, and content areas. Use the default arrow cursor on buttons, not the pointer hand.
- Thin scrollbars (8 to 10px). Thumb `--border-strong`, hover `--bg-hover`.
- Every interactive element needs a keyboard path and a visible focus state.

## Accessibility and motion

- Text contrast of at least 4.5:1 (WCAG AA). Verify with a contrast checker once applied.
- Never rely on color alone for team identity or status.
- Transitions are 120 to 200ms, ease-out, on color, opacity, and transform only.
- Respect `prefers-reduced-motion`.

## Voice

- Sentence case everywhere.
- Buttons say what happens: "Save changes", "Run match", "Delete bot".
- Errors say what went wrong and how to fix it. They do not apologize.
- Use the same name for an action in the button, the toast, and the log.

## Agent do / don’t

**Do**

- Read this guide before adding or changing Studio UI.
- Use semantic tokens and shared button / form / dialog recipes.
- Add new color tokens to both themes (and every shipped palette) in this doc first.

**Don’t**

- Hard-code palette hex/rgb in components (including `#34D27B` or legacy teal `rgb(144, 204, 199)`).
- Invent a second visual system for loading, error, or gate screens.
- Use Inter/JetBrains Mono from a CDN in production.
- Rely on color alone for status or team identity.
