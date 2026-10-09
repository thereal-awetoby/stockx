"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "./ConnectButton";

const NAV = [
  { href: "/markets", label: "Explore", match: (p: string) => p === "/" || p.startsWith("/markets") || p.startsWith("/stock") },
  { href: "/portfolio", label: "Portfolio", match: (p: string) => p.startsWith("/portfolio") },
  { href: "/pocket", label: "Pocket", match: (p: string) => p.startsWith("/pocket") },
];

export default function Header() {
  const path = usePathname() ?? "/";
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="logo" aria-label="stockX home">
          <Image src="/stockx-logo.png" alt="stockX" width={95} height={28} priority />
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={n.match(path) ? "on" : ""}>{n.label}</Link>
          ))}
        </nav>
        <ConnectButton />
      </div>
    </header>
  );
}
