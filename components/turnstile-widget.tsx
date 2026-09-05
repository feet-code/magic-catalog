"use client";

import Script from "next/script";
import { useEffect, useId } from "react";

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey?: string;
  onToken: (token: string) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const callbackName = "magicCatalogTurnstile" + id;

  useEffect(() => {
    if (!siteKey) return;
    window[callbackName] = onToken;
    return () => {
      delete window[callbackName];
    };
  }, [callbackName, onToken, siteKey]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <div
        className="cf-turnstile min-h-[65px]"
        data-sitekey={siteKey}
        data-callback={callbackName}
        data-theme="light"
        data-size="flexible"
      />
    </>
  );
}
