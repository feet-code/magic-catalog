"use client";

import { Check, LoaderCircle } from "lucide-react";
import { FormEvent, useCallback, useState } from "react";
import { captureEvent } from "../lib/analytics-client";
import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function EmailSignup({
  productSlug,
  productName,
  sourceQuery,
  turnstileSiteKey,
}: {
  productSlug: string;
  productName: string;
  sourceQuery?: string;
  turnstileSiteKey?: string;
}) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const receiveToken = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (turnstileSiteKey && !turnstileToken) {
      setError("Complete the verification first.");
      return;
    }
    setStatus("saving");
    setError(undefined);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          company,
          productSlug,
          sourceQuery,
          turnstileToken,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Signup failed.");
      setStatus("saved");
      captureEvent("email_signup", {
        product_slug: productSlug,
        product_name: productName,
        product_query_attributed: Boolean(sourceQuery),
      });
    } catch (caught) {
      setStatus("idle");
      setError(
        caught instanceof Error
          ? caught.message
          : "We could not save your signup. Please try again.",
      );
    }
  }

  if (status === "saved") {
    return (
      <div
        className="rounded-xl bg-accent p-5 text-accent-foreground"
        role="status"
      >
        <div className="flex items-center gap-2 font-bold">
          <Check className="size-5" />
          You are on the list.
        </div>
        <p className="mt-2 text-sm leading-6 opacity-80">
          We will only email you about {productName} and closely related updates.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={"email-" + productSlug}>Email address</Label>
        <Input
          id={"email-" + productSlug}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
          maxLength={254}
          className="h-12 bg-white"
        />
      </div>
      <div className="absolute -left-[10000px]" aria-hidden="true">
        <Label htmlFor={"company-" + productSlug}>Company</Label>
        <Input
          id={"company-" + productSlug}
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        onToken={receiveToken}
      />
      <Button
        type="submit"
        size="lg"
        disabled={status === "saving"}
        className="h-12 w-full rounded-xl font-bold"
      >
        {status === "saving" ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Saving
          </>
        ) : (
          "Join the early-access list"
        )}
      </Button>
      {error ? (
        <p className="text-sm leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        No account required. Unsubscribe from any future email with one click.
      </p>
    </form>
  );
}
