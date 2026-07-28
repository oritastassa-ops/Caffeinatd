import { Card, CardTitle } from "@/components/ui";
import { AIConversation } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

/** Recent assistant threads — only rendered once exchanges persist. */
export function RecentConversations({ conversations }: { conversations: AIConversation[] }) {
  if (conversations.length === 0) return null;
  return (
    <Card>
      <CardTitle>Recent conversations</CardTitle>
      <ul className="flex flex-col gap-2.5">
        {conversations.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="text-accent">
              ✦
            </span>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="tabular shrink-0 text-xs text-text-dim">{relativeTime(c.updated_at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
