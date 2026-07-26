// Demo Controls — deliberately styled as an internal tool, not as product.
//
// The visual separation is the honest move: this is us firing a signal, not the
// product doing something on its own. Synthetic companies have no real-world UI
// to edit, so this is the only way to move them — and it doubles as the real
// company's backup if the BambooHR path stalls mid-demo.

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { listPortfolio } from "@/lib/db/queries";

import { DemoControls } from "./demo-controls";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const { companies } = await listPortfolio();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-3">
        <Link
          href="/"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          ← Portfolio
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              Demo Controls
            </h1>
            <p className="mt-1 text-muted-foreground">
              Internal tool. Fires a signal event at a company on demand.
            </p>
          </div>
          <RealtimeRefresh showIndicator />
        </div>
      </header>

      <DemoControls companies={companies} />
    </main>
  );
}
