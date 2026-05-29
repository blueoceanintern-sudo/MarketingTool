import "./globals.css";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { ReactNode } from "react";
import { Toaster } from "sonner";
import AppSidebar from "@/components/sidebar";
import ProfileHeader from "@/components/profile-header";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata = {
  title: "BlueOcean | Marketing Automation",
  description: "Internal outreach platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="bg-background text-foreground antialiased min-w-[1280px]">
        <AppSidebar />
        <header className="fixed top-0 right-0 left-[220px] h-16 bg-white border-b border-grey-100 z-40 flex items-center justify-between px-10">
          <div className="flex items-center bg-grey-50 border border-grey-100 rounded-lg px-3 py-1.5 w-80 gap-2">
            <span className="material-symbols-outlined text-grey-500 text-[20px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search leads or campaigns..."
              className="bg-transparent border-none focus:outline-none text-[13px] w-full placeholder:text-grey-500"
            />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-grey-500">
              <button className="material-symbols-outlined hover:text-primary transition-colors duration-150 cursor-pointer">
                notifications
              </button>
              <button className="material-symbols-outlined hover:text-primary transition-colors duration-150 cursor-pointer">
                help_outline
              </button>
            </div>
            <div className="h-8 w-px bg-grey-100" />
            <ProfileHeader />
          </div>
        </header>
        <main className="ml-[220px] pt-16 min-h-screen">
          {children}
        </main>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
