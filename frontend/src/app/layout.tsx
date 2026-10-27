import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shop Drawing Reviewer",
  description: "A clearer, more confident way to review steel shop drawings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
