import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { LayoutShell } from "@/components/nav/shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tokenmaxx",
  description: "AI subscription usage tracking and cost attribution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var s = JSON.parse(localStorage.getItem('tokenmaxx:theme') || '{}');
                var slug = s.slug || 'electric';
                var mode = s.mode || 'dark';
                document.documentElement.setAttribute('data-theme', slug);
                document.documentElement.classList.toggle('dark', mode === 'dark');
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LayoutShell>{children}</LayoutShell>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
