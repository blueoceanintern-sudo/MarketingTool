"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "bo_rep_profile";

export interface RepProfile {
  name: string;
  email: string;
  role: string;
}

const DEFAULT_PROFILE: RepProfile = {
  name: "Sales Rep",
  email: "rep@blueocean.internal",
  role: "Sales Representative",
};

export function loadProfile(): RepProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(profile: RepProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export default function ProfileHeader() {
  const [profile, setProfile] = useState<RepProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  const initials = profile.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link
      href="/profile"
      className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-grey-50 transition-colors"
    >
      <div className="text-right">
        <p className="text-[14px] font-semibold text-primary leading-tight">{profile.name}</p>
        <p className="text-[11px] text-grey-500">{profile.role}</p>
      </div>
      <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-white text-xs font-bold">
        {initials}
      </div>
    </Link>
  );
}
