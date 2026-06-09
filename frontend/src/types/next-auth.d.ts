import { DefaultSession } from "next-auth";
import type { Role } from "./auth";

declare module "next-auth" {
  interface Session {
    backendToken: string;
    user: {
      role: Role;
    } & DefaultSession["user"];
  }
}
