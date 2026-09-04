import Link from "next/link";
import { Building } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Sign in" };

/** Demo login — a single Owner account. Real auth is out of scope for v1. */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-xs">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <Building className="size-4.5" strokeWidth={2.25} />
          </span>
          <div>
            <div className="text-sm font-semibold leading-tight">Cedar Holdings</div>
            <div className="text-[11px] text-muted-foreground">Command Center</div>
          </div>
        </div>
        <h1 className="mt-6 text-lg font-semibold tracking-tight">Welcome back, George</h1>
        <p className="mt-1 text-sm text-muted-foreground">Demo workspace — one Owner account, no password.</p>
        <Button asChild className="mt-6 w-full">
          <Link href="/dashboard">Continue as Owner</Link>
        </Button>
      </div>
    </div>
  );
}
