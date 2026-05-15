import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Marketing Tool",
  description: "Internal outreach platform",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <aside className="w-64 border-r bg-muted/40 p-4">
          <h1 className="mb-6 text-xl font-bold">Marketing Tool</h1>

          <nav className="flex flex-col gap-2">
            <a href="#">Campaigns</a>
            <a href="#">Review Queue</a>
            <a href="#">Leads</a>
            <a href="#">Replies</a>
            <a href="#">Dashboard</a>
          </nav>
        </aside>

        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}