# AI Personality Avatars — Character Sheets & System Design

## Art direction (as implemented)

Modern-minimal pixel art, 16×16 portrait busts, rendered as **SVG pixel grids** rather than PNG
sprites — a deliberate substitution: SVG scales crisply at every avatar size (16px chip to 96px
picker card), inherits nothing blurry, needs no binary assets in the repo, and animating means
swapping a data frame, not shipping a GIF. Each character is a 16×16 matrix of palette keys in
`src/components/avatars/pixel-data.ts`; the renderer (`pixel-avatar.tsx`) draws one SVG rect per
pixel with `shape-rendering: crispEdges`. Palettes draw from the app tokens (charcoal, espresso,
cream, burnt orange, amber).

Recognition strategy at 16×16: silhouette + one signature accessory + palette, not facial detail.

## The cast

| | Style | Signature read | Palette anchors | Frames |
|---|---|---|---|---|
| **Janet** | Supportive | long warm-brown hair, burnt-orange scarf, cream cardigan, soft smile | cream / coffee brown / warm orange | base · blink · **sip** (mug raises to mouth) |
| **Juan** | Analytical | short dark hair, slate shirt, glasses band across the eyes, pencil at ear | dark grey / slate / muted blue | base · blink (lens glint) · **jot** (pencil + notepad appear) |
| **Maggie** | Coaching | high ponytail, orange headband, charcoal hoodie with drawstrings | charcoal / orange / warm red | base · blink · **pump** (fist raised, grin widens) |
| **Jimmy** | Casual | messy hair, headphones around the head, dark hoodie, asymmetric smirk | dark hoodie grey / brown / orange pads | base · blink · **sip** (to-go cup) |

Idle loop (client-side, staggered per instance so a page of avatars never blinks in unison):
base ~4s → blink 150ms → base → every ~9s the action frame for 600ms. `thinking` mode cycles
base/action ~450ms with a subtle CSS bob — used while the assistant is generating.

## System architecture

- `src/lib/personalities.ts` — the registry: one entry per personality (id = the existing
  `CommunicationStyle` union, display name, tagline, sample response, prompt persona line).
  **Adding a future personality (Professor, Nutritionist…) = one registry entry + one pixel-data
  entry**; every surface below reads the registry, none hardcode the cast.
- `PixelAvatar` — dumb renderer (personality, size, mode: static|idle|thinking).
- Selected personality keeps living in `profiles.settings.communicationStyle` — no schema change;
  the Settings picker submits the same field the server action already persists, so switching
  updates every surface on the next render, and the system prompt persona line updates with it.
- Domain empty states are cast-mapped deliberately (not selection-mapped): Janet greets an empty
  task list, Maggie an empty workout history, Jimmy an empty shopping list, Juan an empty
  finance dashboard — the whole cast stays visible no matter who you talk to.

## Integration points

Settings personality cards (avatar, name, tagline, sample quote, amber-glow selection with
checkmark and scale) · onboarding communication-style step (same cards, small) · command bar
(avatar in the input row; thinking animation while busy; portrait beside responses) · Today
Morning Brief (avatar beside the greeting) · the four domain empty states.
