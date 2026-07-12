import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/shell/TopBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ChatPanel } from "@/components/assistant/ChatPanel";
import { ConsoleEgg } from "@/components/shell/ConsoleEgg";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Editorial serif for display headings — a cartographer's-journal voice against
// the Geist sans body. Literary, not tavern-kitsch.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Campaign Hub",
  description: "D&D Campaign Management Hub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col bg-background text-foreground overflow-hidden">
        <ToastProvider>
          <ConfirmProvider>
            <TooltipProvider delayDuration={200} skipDelayDuration={100}>
              <TopBar />
              <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
              <CommandPalette />
              <ChatPanel />
              <ConsoleEgg />
            </TooltipProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
