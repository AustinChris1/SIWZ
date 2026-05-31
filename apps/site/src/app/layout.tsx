import type { Metadata } from "next";
import "./globals.css";

// Inline script that runs before React mounts so the html.dark / html.light
// class is set on first paint, eliminating the flash for dark-preferring users.
const THEME_BOOTSTRAP = `
(function(){try{
  var t = localStorage.getItem('siwz.theme');
  var resolved = (t === 'light' || t === 'dark')
    ? t
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.classList.add(resolved);
  document.documentElement.style.colorScheme = resolved;
}catch(e){}})();
`;

export const metadata: Metadata = {
  title: "Sign in with Zcash (SIWZ): the auth primitive Zcash didn't have",
  description:
    "Drop-in, non-custodial sign-in for Zcash apps. Three flows: shielded memo-challenge, signed message, and MetaMask Snap. Three npm packages, ten lines of code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
