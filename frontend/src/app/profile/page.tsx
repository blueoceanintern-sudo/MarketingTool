"use client";

import { useSession, signOut } from "next-auth/react";

export default function ProfilePage() {
  const { data: session } = useSession();

  if (!session) return null;

  const { name, email, image } = session.user;
  const roleLabel = session.user.role === "admin" ? "Admin" : "Sales Rep";

  const initials = (name ?? "")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="p-10 max-w-lg mx-auto">
      <h1 className="text-[20px] font-bold text-primary mb-2">Your Profile</h1>
      <p className="text-[13px] text-grey-500 mb-8">
        Signed in via Google. Contact an admin to change your role.
      </p>

      <div className="bg-white rounded-lg border border-grey-100 p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          {image ? (
            <img src={image} alt={name ?? ""} className="w-14 h-14 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center text-white text-lg font-bold">
              {initials}
            </div>
          )}
          <div>
            <p className="text-[16px] font-semibold text-primary">{name}</p>
            <p className="text-[13px] text-grey-500">{email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <p className="text-grey-400 mb-0.5">Role</p>
            <p className="font-medium">{roleLabel}</p>
          </div>
          <div>
            <p className="text-grey-400 mb-0.5">Provider</p>
            <p className="font-medium">Google</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: "/login" })}
          className="w-full py-2 border border-grey-200 rounded-lg text-[13px] text-danger hover:bg-grey-50 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
