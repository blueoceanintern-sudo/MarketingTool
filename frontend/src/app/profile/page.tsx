"use client";

import { useEffect, useState } from "react";
import {
  loadProfile,
  saveProfile,
  type RepProfile,
} from "@/components/profile-header";

export default function ProfilePage() {
  const [profile, setProfile] = useState<RepProfile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  if (!profile) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-10 max-w-lg mx-auto">
      <h1 className="text-[20px] font-bold text-primary mb-2">Your Profile</h1>
      <p className="text-[13px] text-grey-500 mb-8">
        Rep details shown in the header. Full login is not enabled yet — this is stored locally in your browser.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-grey-100 p-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-[13px]">
          Display name
          <input
            value={profile.name}
            onChange={(e) => setProfile((p) => (p ? { ...p, name: e.target.value } : p))}
            className="border border-grey-200 rounded-lg px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Email
          <input
            type="email"
            value={profile.email}
            onChange={(e) => setProfile((p) => (p ? { ...p, email: e.target.value } : p))}
            className="border border-grey-200 rounded-lg px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Role
          <input
            value={profile.role}
            onChange={(e) => setProfile((p) => (p ? { ...p, role: e.target.value } : p))}
            className="border border-grey-200 rounded-lg px-3 py-2"
          />
        </label>
        <button type="submit" className="px-6 py-2 bg-primary text-white rounded-lg font-semibold text-[14px]">
          Save profile
        </button>
        {saved && <p className="text-success text-[13px]">Saved. Refresh other tabs to see updates in the header.</p>}
      </form>
    </div>
  );
}
