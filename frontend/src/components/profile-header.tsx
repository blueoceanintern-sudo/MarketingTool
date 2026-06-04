"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "bo_rep_profile";
const CHANGE_EVENT = "bo-profile-change";

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
  // `storage` only fires in other tabs; dispatch our own event so the header
  // updates in this tab too.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ── External-store glue (SSR-safe reads without effect/setState) ──────────────
export function subscribeProfile(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

// getSnapshot must return a cached reference when unchanged, or React loops.
let cachedRaw: string | null | undefined;
let cachedProfile: RepProfile = DEFAULT_PROFILE;
export function getProfileSnapshot(): RepProfile {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedProfile;
  cachedRaw = raw;
  cachedProfile = loadProfile();
  return cachedProfile;
}

export function getServerProfile(): RepProfile {
  return DEFAULT_PROFILE;
}

export default function ProfileHeader() {
  const profile = useSyncExternalStore(subscribeProfile, getProfileSnapshot, getServerProfile);

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
