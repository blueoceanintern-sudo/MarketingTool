"use client";

import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";

export default function ProfileHeader() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const name = session?.user?.name ?? "Team Member";
  const email = session?.user?.email ?? "";
  const image = session?.user?.image;
  const roleLabel = session?.user?.role === "admin" ? "Admin" : "Sales Rep";

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-grey-50 transition-colors"
      >
        <div className="text-right">
          <p className="text-[14px] font-semibold text-primary leading-tight">{name}</p>
          <p className="text-[11px] text-grey-500">{roleLabel}</p>
        </div>
        {image ? (
          <img src={image} alt={name} className="w-9 h-9 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-white text-xs font-bold">
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-grey-100 rounded-lg shadow-md py-1 z-50">
          <div className="px-4 py-2 border-b border-grey-100">
            <p className="text-[13px] font-semibold truncate">{name}</p>
            <p className="text-[11px] text-grey-400 truncate">{email}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="w-full text-left px-4 py-2 text-[13px] text-danger hover:bg-grey-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
