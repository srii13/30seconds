import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wingo Intelligence",
  description: "Historical result collection, statistical analysis and simulated forecasting."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
