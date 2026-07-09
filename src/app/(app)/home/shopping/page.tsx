import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { fetchHomeData } from "@/lib/home/data";
import { ShoppingView } from "@/components/home/shopping-view";
import { addShoppingList } from "../actions";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const { supabase, user } = await requireUser();
  const data = await fetchHomeData(supabase, user.id);

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Shopping</h1>
        <Card>
          <p className="text-sm text-text-dim">
            <Link href="/home" className="text-accent hover:underline">
              Set up your household
            </Link>{" "}
            first — shopping lists are shared.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Shopping</h1>
        <Link href="/home" className="text-sm text-text-dim hover:text-text hover:underline">
          ← Home
        </Link>
      </div>

      <ShoppingView lists={data.lists} items={data.items} />

      <Card>
        <form action={addShoppingList} className="flex gap-2">
          <input
            name="name"
            placeholder='New list (e.g. "Costco", "Camping trip")'
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button className="transition-fast rounded-xl border px-4 text-sm font-medium hover:border-accent">
            Create list
          </button>
        </form>
      </Card>
    </div>
  );
}
