"use client";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { setApiToken } from "@/lib/api";

export function TokenSync() {
  const { data: session } = useSession();
  useEffect(() => {
    if (session?.backendToken) {
      setApiToken(session.backendToken);
    }
  }, [session]);
  return null;
}
