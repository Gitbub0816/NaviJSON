import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "NaviJSON California Light",
    template: "%s · NaviJSON",
  },
  description:
    "A refined, Mapbox-compatible light map style with NaviJSON GeoJSON enrichment layers.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "NaviJSON California Light",
    description:
      "Refined Mapbox-compatible light cartography with GeoJSON enrichment.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "NaviJSON California Light map" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NaviJSON California Light",
    description:
      "Refined Mapbox-compatible light cartography with GeoJSON enrichment.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
