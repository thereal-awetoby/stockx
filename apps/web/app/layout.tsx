import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "../components/Providers";
import Header from "../components/Header";

export const metadata: Metadata = {
  title: "stockX",
  description: "A stock swap ticket on BNB Chain.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}