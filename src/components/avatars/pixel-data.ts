import { CommunicationStyle } from "@/lib/types";

/**
 * The cast, as data: each character is a `size`×`size` grid of palette keys
 * ('.' = transparent), three frames each (base / blink / action).
 * Redesigned at native 32×32: recognition still comes from silhouette +
 * one signature accessory + palette, but the extra resolution buys real
 * shading (skin shadow, hair highlight, blush) and readable expressions.
 * Blink/action are authored as row edits on base via `withRows`, so the
 * frames can only differ where intended. Adding a future personality means
 * adding one entry here and one in lib/personalities.ts.
 * Grid integrity (row count, row width, palette keys) is unit-tested.
 */

export interface PixelCharacter {
  /** Grid dimension — rows and row width must both equal this. */
  size: number;
  palette: Record<string, string>;
  frames: {
    base: string[];
    blink: string[];
    action: string[]; // the idle "signature move": sip / jot / fist-pump / sip
  };
}

/** Derive a frame from base by replacing whole rows — keeps diffs intentional. */
function withRows(base: string[], edits: Record<number, string>): string[] {
  return base.map((row, i) => edits[i] ?? row);
}

/* ── Janet — Supportive ──────────────────────────────────────────────────
   Long warm-brown hair with a highlight sweep, burnt-orange scarf, cream
   cardigan over a white blouse, soft smile, rosy blush.
   Action: raises her coffee mug beside her face (steam curl above). */
const janetBase = [
  "............hhhhhhhh............",
  ".........hhhhhhhhhhhhhh.........",
  "........hhhhhhhhhhhhhhhh........",
  ".......hhhhhhLLLLhhhhhhhh.......",
  "......hhhhhLLhhhhhhhhhhhhh......",
  ".....hhhhhLLhhhhhhhhhhhhhhh.....",
  ".....hhhHssssssssssssssHhhh.....",
  "....hhhHssssssssssssssssHhhh....",
  "....hhHssssssssssssssssssHhh....",
  "....hhHssssssssssssssssssHhh....",
  "....hhHssssssssssssssssssHhh....",
  "....hhHsskkwssssssskkwsssHhh....",
  "....hhHsskkkssssssskkksssHhh....",
  "....hhHsrrsssssSSsssssrrsHhh....",
  "....hhHssssssssssssssssssHhh....",
  "....hhHsssssssmmmmsssssssHhh....",
  "....hhHssssssssSSssssssssHhh....",
  "....hhHHssssssssssssssssHHhh....",
  "....hhhHHssssssssssssssHHhhh....",
  ".....hhhHHssssssssssssHHhhh.....",
  ".....hhhh..ssssssssss..hhhh.....",
  ".....hhhh..sssSSSSsss..hhhh.....",
  ".....hhh..ffffffffffff..hhh.....",
  ".....hh.ffffffffffffffff.hh.....",
  ".....hh.ffFFffffffffFFff.hh.....",
  "....hh.ccccccffffffcccccc.hh....",
  "....ccccccccccffffcccccccccc....",
  "...cccccccccccffffccccccccccc...",
  "...cccCcccccccwwwwcccccccCccc...",
  "...cccCcccccccwwwwcccccccCccc...",
  "..ccccCcccccccwwwwcccccccCcccc..",
  "..ccccccccccccwwwwcccccccccccc..",
];
const janet: PixelCharacter = {
  size: 32,
  palette: {
    h: "#8a5a3b", H: "#6b4226", L: "#a9754f",
    s: "#eab98d", S: "#d29b6d", r: "#e8987a",
    k: "#2a211c", m: "#7c4a35", w: "#fff7ea",
    f: "#d97706", F: "#b45309",
    c: "#f0e3cc", C: "#d9c7a8", o: "#f59e0b",
  },
  frames: {
    base: janetBase,
    blink: withRows(janetBase, {
      11: "....hhHssssssssssssssssssHhh....",
      12: "....hhHssSSSsssssssSSSsssHhh....",
    }),
    action: withRows(janetBase, {
      7: "....hhhHssssssssssssssssHhhh.w..",
      8: "....hhHssssssssssssssssssHhh..w.",
      12: "....hhHsskkkssssssskkksssHhwwww.",
      13: "....hhHsrrsssssSSsssssrrsHhwoow.",
      14: "....hhHssssssssssssssssssHhwwww.",
      15: "....hhHsssssssmmmmsssssssHhssss.",
    }),
  },
};

/* ── Juan — Analytical ───────────────────────────────────────────────────
   Short dark hair with a sheen, rimmed glasses with a light catch, slate
   button-up with a white placket, pencil tucked at his right temple.
   Action: a notepad and pencil appear at his side — he's jotting. */
const juanBase = [
  "..............hhhh..............",
  "...........hhhhhhhhhh...........",
  ".........hhhhhhhhhhhhhh.........",
  "........hhhhLLhhhhhhhhhh........",
  "........hhhhhhhhhhhhhhhh........",
  ".......hhhhhhhhhhhhhhhhhh.......",
  ".......hhhhhhhhhhhhhhhhhh.......",
  ".......hhsssssssssssssshh.......",
  "......hhsssssssssssssssshh......",
  "......hssssssssssssssssssh.p....",
  "......hsskkkkkkkkkkkkkkssh.p....",
  "......hsskuUuksssskuUukssh.p....",
  "......hsskuuuksssskuuukssh......",
  "......hssssssssSSssssssssh......",
  "......hssssssssssssssssssh......",
  "......hssssssssmmssssssssh......",
  "......hssssssssSSssssssssh......",
  ".......hssssssssssssssssh.......",
  "........hssssssssssssssh........",
  "..........ssssssssssss..........",
  "..........ssssSSSSssss..........",
  "...........ssssssssss...........",
  ".....GGgggggwwsssswwgggggGG.....",
  "....GGggggggggwwwwggggggggGG....",
  "...GGgggggggggwkkwgggggggggGG...",
  "...GGgggggggggwwwwgggggggggGG...",
  "...GGgggggggggwkkwgggggggggGG...",
  "..GGggggggggggwwwwggggggggggGG..",
  "..GGggggggggggwwwwggggggggggGG..",
  "..GGggggggggggwkkwggggggggggGG..",
  "..GGggggggggggwwwwggggggggggGG..",
  "..GGGgggggggggwwwwgggggggggGGG..",
];
const juan: PixelCharacter = {
  size: 32,
  palette: {
    h: "#2f2a28", L: "#4a423d",
    s: "#d9a06b", S: "#c08a55",
    k: "#26211e", m: "#6e4a30", w: "#fff7ea",
    u: "#7d8fc4", U: "#9db0d8",
    g: "#52525b", G: "#3f3f46", p: "#f59e0b",
  },
  frames: {
    base: juanBase,
    blink: withRows(juanBase, {
      11: "......hsskuuuksssskuuukssh.p....",
      12: "......hsskkkkksssskkkkkssh......",
    }),
    action: withRows(juanBase, {
      24: "...GGgggggggggwkkwgggggggGGp....",
      25: "...GGgggggggggwwwwgggggggGkwwk..",
      26: "...GGgggggggggwkkwgggggggGkwwk..",
    }),
  },
};

/* ── Maggie — Coaching ───────────────────────────────────────────────────
   High ponytail swinging behind her, orange headband, big toothy grin,
   charcoal hoodie with drawstrings and a kangaroo pocket.
   Action: fist pumps skyward, grin widens. */
const maggieBase = [
  "............hhhhhh....hhh.......",
  "..........hhhhhhhhhh..hhhh......",
  ".........hhhhhhhhhhhh.hhhh......",
  ".........hLLhhhhhhhhh..hhh......",
  "........hhLLhhhhhhhhhh.hhh......",
  "........hhhhhhhhhhhhhh.hhh......",
  "........oooooooooooooo..hh......",
  "........oOOooooooooooO..hh......",
  "........hssssssssssssh..hh......",
  ".......hssssssssssssssh..h......",
  ".......hssssssssssssssh..h......",
  ".......hsskkwsssskkwssh..h......",
  ".......hsskkksssskkkssh..h......",
  ".......hsrrssssSSssrrsh..h......",
  ".......hssssmwwwwmssssh.........",
  ".......hsssssmmmmsssssh.........",
  "........hssssssssssssh..........",
  ".........hssssssssssh...........",
  "............ssssssss............",
  "............ssSSSSss............",
  ".......ggggg.ssssss.ggggg.......",
  "......gggggggssssssggggggg......",
  ".....ggggggggggoogggggggggg.....",
  "....GggggggggogggogggggggggG....",
  "....GggggggggogggogggggggggG....",
  "....GgggggGGGGGGGGGGGGgggggG....",
  "....GgggggGGGGGGGGGGGGgggggG....",
  "....GgggggGGGGGGGGGGGGgggggG....",
  "...GggggggGGGGGGGGGGGGggggggG...",
  "...GggggggGGGGGGGGGGGGggggggG...",
  "...GggggggggggggggggggggggggG...",
  "...GGGGGGGGGGGGGGGGGGGGGGGGGG...",
];
const maggie: PixelCharacter = {
  size: 32,
  palette: {
    h: "#a8552e", L: "#c9713f",
    s: "#e5a877", S: "#cd8d5c", r: "#dd8663",
    k: "#2a211c", m: "#7c4030", w: "#fff7ea",
    o: "#d97706", O: "#b45309",
    g: "#2f2f36", G: "#26262c",
  },
  frames: {
    base: maggieBase,
    blink: withRows(maggieBase, {
      11: ".......hssssssssssssssh..h......",
      12: ".......hssSSSssssSSSssh..h......",
    }),
    action: withRows(maggieBase, {
      6: "........oooooooooooooo..hh..ss..",
      7: "........oOOooooooooooO..hh..ss..",
      8: "........hssssssssssssh..hh..gg..",
      9: ".......hssssssssssssssh..h..gg..",
      10: ".......hssssssssssssssh..h..gg..",
      11: ".......hsskkwsssskkwssh..h.gg...",
      12: ".......hsskkksssskkkssh..h.gg...",
      13: ".......hsrrssssSSssrrsh.gg......",
      14: ".......hsssmwwwwwwmsssh.gg......",
      15: ".......hssssmmmmmmssssh.g.......",
    }),
  },
};

/* ── Jimmy — Casual ──────────────────────────────────────────────────────
   Messy hair spikes, amber headphones clamped over the head, half-lidded
   ease, asymmetric smirk, dark zip hoodie with drawstrings.
   Action: sips a to-go coffee beside his cheek. */
const jimmyBase = [
  ".......h..hh...hh..hh..h........",
  "........hhhhhhhhhhhhhhhh........",
  ".......hhhhhhhhhhhhhhhhhh.......",
  "......kkkkkkkkkkkkkkkkkkkk......",
  "......kkhhhhhhhhhhhhhhhhkk......",
  ".....okkhhhhhhhhhhhhhhhhkko.....",
  ".....okhhsssssssssssssshhko.....",
  ".....okhsssssssssssssssshko.....",
  ".....okhsssssssssssssssshko.....",
  "......hssssssssssssssssssh......",
  "......hsshhhssssssshhhsssh......",
  "......hsskkwssssssskkwsssh......",
  "......hsskkkssssssskkksssh......",
  "......hssssssssSSssssssssh......",
  "......hssssssssssssssssssh......",
  "......hssssssssssmmmsssssh......",
  "......hssssssssSSssssssssh......",
  ".......hssssssssssssssssh.......",
  "........hssssssssssssssh........",
  "...........ssssssssss...........",
  "...........ssSSSSssss...........",
  "......gggggg.ssssss.gggggg......",
  ".....gggggggggssssggggggggg.....",
  "....GgggggggggwGGwgggggggggG....",
  "....GgggggggggwGGwgggggggggG....",
  "...GggggggggggwGGwggggggggggG...",
  "...GgggggggggggGGgggggggggggG...",
  "...GgggggggggggGGgggggggggggG...",
  "...GgggggggggggGGgggggggggggG...",
  "...GgggggggggggGGgggggggggggG...",
  "...GgggggggggggGGgggggggggggG...",
  "...GGGGGGGGGGGGGGGGGGGGGGGGGG...",
];
const jimmy: PixelCharacter = {
  size: 32,
  palette: {
    h: "#5b4632", L: "#75603f",
    s: "#e7b489", S: "#d19a67",
    k: "#26211e", m: "#71462f", w: "#fff7ea",
    o: "#d97706", O: "#b45309",
    g: "#3a3733", G: "#2d2b28",
  },
  frames: {
    base: jimmyBase,
    blink: withRows(jimmyBase, {
      11: "......hssssssssssssssssssh......",
      12: "......hssSSSsssssssSSSsssh......",
    }),
    action: withRows(jimmyBase, {
      12: "......hsskkkssssssskkksssh..w...",
      13: "......hssssssssSSssssssssh.www..",
      14: "......hssssssssssssssssssh.wow..",
      15: "......hssssssssssmmmsssssh.wow..",
      16: "......hssssssssSSssssssssh.www..",
    }),
  },
};

export const PIXEL_CHARACTERS: Record<CommunicationStyle, PixelCharacter> = {
  supportive: janet,
  analytical: juan,
  coaching: maggie,
  casual: jimmy,
};
