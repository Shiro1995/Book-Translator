import { Suspense } from "react";
import { Outlet, ScrollRestoration } from "react-router-dom";

function RouterFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F5F0] text-[#141414] dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <div className="rounded-2xl border border-black/10 bg-white/70 px-6 py-4 text-sm font-medium backdrop-blur dark:border-white/10 dark:bg-zinc-900/70">
        Đang tải module...
      </div>
    </div>
  );
}

export function RootLayout() {
  return (
    <Suspense fallback={<RouterFallback />}>
      <ScrollRestoration />
      <Outlet />
    </Suspense>
  );
}
