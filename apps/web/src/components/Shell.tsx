"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MessengerApp } from "./MessengerApp";

const STANDALONE = new Set(["/about", "/privacy", "/download"]);

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() || "/";
  if (STANDALONE.has(path)) return children;
  return (
    <>
      <MessengerApp />
      {children}
    </>
  );
}
