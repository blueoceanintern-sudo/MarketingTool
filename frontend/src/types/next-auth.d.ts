import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    backendToken: string;
    user: {
      role: "admin" | "rep";
    } & DefaultSession["user"];
  }
}
