"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./logo";

const NAV = [
  { href: "/", label: "Today", icon: "◈" },
  { href: "/home", label: "Home", icon: "⌂" },
  { href: "/tasks", label: "Tasks", icon: "☑" },
  { href: "/calendar", label: "Calendar", icon: "▦" },
  { href: "/fitness", label: "Fitness", icon: "⚡" },
  { href: "/nutrition", label: "Nutrition", icon: "◐" },
  { href: "/finance", label: "Finance", icon: "◎" },
  { href: "/memory", label: "Memory", icon: "✦" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();

  const items = NAV.map((item) => {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "transition-fast flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
          active
            ? "bg-accent-soft font-medium text-accent"
            : "text-text-dim hover:bg-surface-2 hover:text-text",
        )}
      >
        <span aria-hidden className="w-4 text-center">
          {item.icon}
        </span>
        <span className="max-md:hidden">{item.label}</span>
      </Link>
    );
  });

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r bg-surface p-3 md:flex">
        <div className="mb-6 flex items-center justify-between px-3 pt-2">
          <Wordmark uid="sidebar" />
          <ThemeToggle />
        </div>
        <nav className="flex flex-col gap-0.5">{items}</nav>
        <p className="mt-auto px-3 pb-2 text-[11px] text-text-dim">
          Your AI life assistant, over coffee ☕
        </p>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-surface/95 py-1 backdrop-blur md:hidden">
        {items}
      </nav>
    </>
  );
}
