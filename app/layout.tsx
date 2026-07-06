import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/shell/TopBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col bg-background text-foreground overflow-hidden">
        <ToastProvider>
          <ConfirmProvider>
            <TooltipProvider delayDuration={200} skipDelayDuration={100}>
              <TopBar />
              <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
              <CommandPalette />
            </TooltipProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
