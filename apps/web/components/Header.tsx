"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ConnectButton from "./ConnectButton";

const TOOLS = [
  { href: "/tools/bridge", title: "Bridge", sub: "Move tokens across chains" },
  { href: "/tools/convert", title: "Convert", sub: "Swap one stock token for another" },
  { href: "/pocket", title: "Agent", sub: "Automate buys from a funded pocket" },
];

export default function Header() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (menu.current && !menu.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const exploreOn = path === "/" || path.startsWith("/markets") || path.startsWith("/stock");
  const toolsOn = path.startsWith("/tools") || path.startsWith("/pocket");

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="logo" aria-label="stockX home">
          <Image src="/stockx-logo.png" alt="stockX" width={95} height={28} priority />
        </Link>
        <nav className="nav">
          <Link href="/markets" className={exploreOn ? "on" : ""}>Explore</Link>
          <Link href="/portfolio" className={path.startsWith("/portfolio") ? "on" : ""}>Portfolio</Link>
          <div className="dd" ref={menu}>
            <button type="button" className={`nav-btn ${toolsOn ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              Tools <span aria-hidden>▾</span>
            </button>
            {open && (
              <div className="dd-menu" role="menu">
                {TOOLS.map((t) => (
                  <Link key={t.href} href={t.href} className="dd-item" role="menuitem" onClick={() => setOpen(false)}>
                    <strong>{t.title}</strong>
                    <span>{t.sub}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>
        <ConnectButton />
      </div>
    </header>
  );
}
