import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Toast from "@/components/Toast";
import Lightbox from "@/components/Lightbox";

export const metadata: Metadata = {
  title: "UPSC Diagrams",
  description: "AI-powered UPSC diagram generation tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
        <Lightbox />
        <Toast />
      </body>
    </html>
  );
}
