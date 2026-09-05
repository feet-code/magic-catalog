"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { captureEvent } from "../lib/analytics-client";

export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    captureEvent("page_viewed");
  }, [pathname]);
  return null;
}
