import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { fetchHomeData } from "@/lib/home/data";
import { ShoppingView } from "@/components/home/shopping-view";
import { addShoppingList } from "../actions";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const { supabase, user } = await requireUser();
  const data = await fetchHomeData(supabase, user.id);

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <PageHeader title="Shopping" back={{ href: "/home", label: "Home" }} />
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Shopping" back={{ href: "/home", label: "Home" }} />

      <ShoppingView lists={data.lists} items={data.items} />

      <Card>
        <form action={addShoppingList} className="flex items-end gap-2">
          <Input
            name="name"
            aria-label="New list name"
            placeholder='New list (e.g. "Costco", "Camping trip")'
            autoComplete="off"
            containerClassName="min-w-0 flex-1"
          />
          <Button type="submit" variant="secondary">
            Create list
          </Button>
        </form>
      </Card>
    </div>
  );
}
