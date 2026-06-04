"use client";

import { useState, useSyncExternalStore, type SubmitEvent } from "react";
import {
  saveProfile,
  subscribeProfile,
  getProfileSnapshot,
  type RepProfile,
} from "@/components/profile-header";

export default function ProfilePage() {
  // null on the server / during hydration, then the stored profile on the client
  // — no effect+setState needed.
  const stored = useSyncExternalStore(subscribeProfile, getProfileSnapshot, () => null);
  if (!stored) return null;
  return <ProfileForm initial={stored} />;
}

function ProfileForm({ initial }: { initial: RepProfile }) {
  const [profile, setProfile] = useState<RepProfile>(initial);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
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
            onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            className="border border-grey-200 rounded-lg px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Email
          <input
            type="email"
            value={profile.email}
            onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
            className="border border-grey-200 rounded-lg px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Role
          <input
            value={profile.role}
            onChange={(e) => setProfile((p) => ({ ...p, role: e.target.value }))}
            className="border border-grey-200 rounded-lg px-3 py-2"
          />
        </label>
        <button type="submit" className="px-6 py-2 bg-primary text-white rounded-lg font-semibold text-[14px]">
          Save profile
        </button>
        {saved && <p className="text-success text-[13px]">Saved — the header updates automatically.</p>}
      </form>
    </div>
  );
}
