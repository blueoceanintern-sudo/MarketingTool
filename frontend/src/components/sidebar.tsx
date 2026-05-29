"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/campaigns", label: "Campaigns", icon: "campaign" },
  { href: "/leads",     label: "Leads",      icon: "group" },
  { href: "/drafts",    label: "Draft Queue", icon: "pending_actions" },
  { href: "/replies",   label: "Replies",    icon: "reply" },
  { href: "/analytics", label: "Analytics",  icon: "analytics" },
  { href: "/registry",  label: "Source Registry", icon: "database" },
  { href: "/templates", label: "Email Templates", icon: "auto_awesome" },
];

export default function AppSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-white border-r border-grey-100 shadow-[1px_0_3px_rgba(27,45,91,0.08)] flex flex-col py-6 z-50">
      <div className="px-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center text-white">
            <span className="material-symbols-outlined text-[18px]">waves</span>
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-primary leading-tight">
              BlueOcean
            </h1>
            <p className="text-[10px] text-grey-500 uppercase tracking-wider font-bold">
              Marketing Automation
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-0.5 px-2">
        {navItems.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg text-[13px] transition-colors duration-150 active:scale-[0.98]",
              isActive(href)
                ? "text-primary font-bold bg-ocean-wash"
                : "text-grey-500 hover:bg-ocean-wash"
            )}
          >
            <span className="material-symbols-outlined text-[22px]">{icon}</span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="px-2 mt-auto border-t border-grey-100 pt-3">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-lg text-[13px] transition-colors duration-150",
            isActive("/settings")
              ? "text-primary font-bold bg-ocean-wash"
              : "text-grey-500 hover:bg-ocean-wash"
          )}
        >
          <span className="material-symbols-outlined text-[22px]">settings</span>
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
