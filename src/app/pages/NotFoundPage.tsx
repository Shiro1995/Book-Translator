import { Link } from "react-router-dom";
import { routePaths } from "@/app/router/paths";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F5F0] px-6 text-[#141414] dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <div className="max-w-md rounded-3xl border border-black/10 bg-white/80 p-8 text-center dark:border-white/10 dark:bg-zinc-900/70">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">404</p>
        <h1 className="mt-3 text-3xl font-semibold">Không tìm thấy trang</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Route này chưa được đăng ký trong app router.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to={routePaths.home}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5"
          >
            Trang chủ
          </Link>
          <Link
            to={routePaths.bookTranslation}
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Dịch sách
          </Link>
        </div>
      </div>
    </main>
  );
}
