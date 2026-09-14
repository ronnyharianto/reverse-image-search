import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copyright Image Scanner",
  description:
    "Local copyright-risk screening tool: crawls a website, screens its images via reverse image search, and lists images that may require review.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
