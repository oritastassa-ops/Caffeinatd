import { twMerge } from "tailwind-merge";

/**
 * Like `cn`, but resolves *conflicting* Tailwind utilities (last one wins), so a
 * caller's `className` reliably overrides a primitive's defaults — e.g. `Stat`
 * passing `p-4` to a `Card` whose default is `p-5`, or a caller narrowing a
 * Button's padding. Plain `cn` only concatenates, leaving both classes in the
 * string and the winner up to stylesheet order. Design-system internal: the
 * primitives compose through this so the "className overrides" contract in
 * docs/18-design-system.md is actually true.
 */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes.filter(Boolean).join(" "));
}
