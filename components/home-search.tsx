"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { captureEvent } from "../lib/analytics-client";

export function HomeSearch() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 4) return;
    captureEvent("search_submitted", {
      query_length: value.length,
      search_origin: "home",
    });
    router.push("/search?q=" + encodeURIComponent(value));
  }

  return (
    <form onSubmit={submit} className="w-full" role="search">
      <div className="magic-search flex items-center gap-2 rounded-2xl border border-border bg-white p-2 pl-4">
        <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={4}
          maxLength={320}
          required
          autoFocus
          aria-label="Describe the product you need"
          placeholder="e.g. match freight invoices to contracted rates and find overcharges"
          className="h-14 border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0 md:text-lg"
        />
        <Button
          type="submit"
          size="lg"
          className="h-12 shrink-0 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Find it
        </Button>
      </div>
    </form>
  );
}
