import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sign in with Zcash (SIWZ): the auth primitive Zcash didn't have",
  description:
    "Drop-in, non-custodial sign-in for Zcash apps. Three flows: shielded memo-challenge, signed message, and MetaMask Snap. Three npm packages, ten lines of code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
