"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ShoppingItem, ShoppingList } from "@/lib/types";
import {
  addShoppingItem, clearCompletedItems, deleteShoppingItem, toggleShoppingItem,
} from "@/app/(app)/home/actions";
import { Card, CardTitle, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, string> = {
  produce: "🥬", bakery: "🥖", dairy: "🥛", frozen: "🧊", meat: "🥩", seafood: "🐟",
  pantry: "🥫", snacks: "🍿", drinks: "☕", cleaning: "🧼", toiletries: "🧻", pets: "🐾", other: "🛒",
};
const CATEGORY_ORDER = [
  "produce", "bakery", "dairy", "meat", "seafood", "frozen", "pantry", "snacks",
  "drinks", "cleaning", "toiletries", "pets", "other",
];

type ItemAction =
  | { type: "toggle"; id: string; done: boolean }
  | { type: "delete"; id: string }
  | { type: "clearCompleted"; listId: string };

export function ShoppingView({ lists, items }: { lists: ShoppingList[]; items: ShoppingItem[] }) {
  const [activeListId, setActiveListId] = useState(lists[0]?.id ?? "");
  const [, startTransition] = useTransition();
  // Check-offs land instantly; the server's revalidated rows replace them.
  const [optimisticItems, apply] = useOptimistic(items, (state: ShoppingItem[], action: ItemAction) => {
    switch (action.type) {
      case "toggle":
        return state.map((i) =>
          i.id === action.id ? { ...i, completed_at: action.done ? new Date().toISOString() : null } : i,
        );
      case "delete":
        return state.filter((i) => i.id !== action.id);
      case "clearCompleted":
        return state.filter((i) => !(i.list_id === action.listId && i.completed_at));
    }
  });
  const active = lists.find((l) => l.id === activeListId) ?? lists[0];
  if (!active) return <p className="text-sm text-text-dim">Create a list to get started.</p>;

  const listItems = optimisticItems.filter((i) => i.list_id === active.id);
  const open = listItems.filter((i) => !i.completed_at);
  const done = listItems.filter((i) => i.completed_at);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: open.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* List switcher */}
      <div className="flex flex-wrap gap-2">
        {lists.map((l) => (
          <button
            key={l.id}
            onClick={() => setActiveListId(l.id)}
            className={cn(
              "transition-fast rounded-full border px-3.5 py-1.5 text-sm",
              l.id === active.id
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "text-text-dim hover:border-accent/50 hover:text-text",
            )}
          >
            {l.name}
            <span className="tabular ml-1.5 text-xs opacity-70">
              {optimisticItems.filter((i) => i.list_id === l.id && !i.completed_at).length}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <form action={addShoppingItem} className="flex gap-2">
          <input type="hidden" name="list_id" value={active.id} />
          <input
            name="name"
            placeholder={`Add to ${active.name}… (e.g. "milk")`}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            name="quantity"
            placeholder="Qty"
            autoComplete="off"
            className="w-20 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button className="transition-fast rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90">
            Add
          </button>
        </form>

        {open.length === 0 && done.length === 0 && (
          <EmptyState
            character="casual"
            title="Jimmy's holding an empty basket"
            hint="Nothing here yet — ⌘K “we need milk” works too."
          />
        )}

        {grouped.map((g) => (
          <div key={g.cat} className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-dim">
              {CATEGORY_ICONS[g.cat]} {g.cat}
            </p>
            <ul className="flex flex-col">
              {g.items.map((item) => (
                <li key={item.id} className="group flex items-center gap-3 border-b py-2 last:border-b-0">
                  <button
                    aria-label={`Check off ${item.name}`}
                    onClick={() =>
                      startTransition(() => {
                        apply({ type: "toggle", id: item.id, done: true });
                        return toggleShoppingItem(item.id, true);
                      })
                    }
                    className="transition-fast h-[18px] w-[18px] shrink-0 rounded-md border hover:border-accent"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {item.name}
                    {item.quantity && <span className="ml-2 text-xs text-text-dim">{item.quantity}</span>}
                  </span>
                  <button
                    aria-label="Remove item"
                    onClick={() =>
                      startTransition(() => {
                        apply({ type: "delete", id: item.id });
                        return deleteShoppingItem(item.id);
                      })
                    }
                    className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {done.length > 0 && (
          <div className="mt-5 border-t pt-3">
            <div className="flex items-center justify-between">
              <CardTitle>In your cart · {done.length}</CardTitle>
              <button
                onClick={() =>
                  startTransition(() => {
                    apply({ type: "clearCompleted", listId: active.id });
                    return clearCompletedItems(active.id);
                  })
                }
                className="text-xs text-text-dim hover:text-bad hover:underline"
              >
                Clear completed
              </button>
            </div>
            <ul className="flex flex-col">
              {done.map((item) => (
                <li key={item.id} className="flex items-center gap-3 border-b py-1.5 text-sm last:border-b-0">
                  <button
                    aria-label={`Uncheck ${item.name}`}
                    onClick={() =>
                      startTransition(() => {
                        apply({ type: "toggle", id: item.id, done: false });
                        return toggleShoppingItem(item.id, false);
                      })
                    }
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-good bg-good text-[11px] text-white"
                  >
                    ✓
                  </button>
                  <span className="truncate text-text-dim line-through">{item.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
