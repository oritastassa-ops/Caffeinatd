import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The top of a page: title, optional description, optional action slot, and an
 * optional back link (e.g. a settings sub-page). Replaces the hand-written
 * `<h1 className="text-2xl font-semibold tracking-tight">` copy-pasted across
 * pages — the title size now lives in the `text-title` token.
 */
export function PageHeader({
  title,
  description,
  action,
  back,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {back && (
        <Link href={back.href} className="transition-fast text-sm text-text-dim hover:text-text">
          ← {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-dim">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
