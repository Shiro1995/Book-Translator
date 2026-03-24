import { Link } from "react-router-dom";
import { appModules } from "@/app/router/modules";

export default function ModuleHubPage() {
  return (
    <main className="min-h-screen bg-[#F5F5F0] px-6 py-12 text-[#141414] dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">
            Module Registry
          </p>
          <h1 className="serif text-4xl font-semibold italic tracking-tight">Workspace Modules</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Router được tách theo module. Muốn mở rộng thêm chức năng, chỉ cần tạo module mới và
            đăng ký trong registry.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {appModules.map((moduleItem) => (
            <Link
              key={moduleItem.key}
              to={moduleItem.href}
              className="group rounded-3xl border border-black/10 bg-white/80 p-6 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg dark:border-white/10 dark:bg-zinc-900/70"
            >
              <div className="mb-3 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
                {moduleItem.key}
              </div>
              <h2 className="text-xl font-semibold">{moduleItem.title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {moduleItem.description}
              </p>
              <div className="mt-5 text-sm font-medium text-emerald-600">Open module</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
