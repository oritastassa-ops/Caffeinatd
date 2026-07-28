import Link from "next/link";
import { Card, CardTitle, EmptyState } from "@/components/ui";

/** The day's top priorities — from the plan, or the top open tasks as fallback. */
export function TodayFocus({ items }: { items: string[] }) {
  return (
    <Card>
      <CardTitle>Today&apos;s focus</CardTitle>
      {items.length === 0 ? (
        <EmptyState title="A fresh cup, a fresh start ☕" hint="Nothing prioritized yet — ask me to plan your day." />
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="font-semibold text-accent">{i + 1}.</span>
              <Link href="/tasks" className="hover:underline">
                {item}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
