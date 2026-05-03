import "./globals.css";
import "@ank1015-app/ui/filesystem.css";

export const metadata = {
  title: "ank1015 web",
  description: "Shared UI monorepo web app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
