import { lazy } from "react";
import type { AppModuleDefinition } from "@/app/router/types";
import { routePaths, routeSegments } from "@/app/router/paths";

const BookTranslationPage = lazy(
  () => import("@/modules/book-translation/pages/BookTranslationPage"),
);

export const bookTranslationModule: AppModuleDefinition = {
  key: "book-translation",
  title: "Book Translation",
  description: "Module dich sach, tach trang, chay auto translation va export PDF.",
  href: routePaths.bookTranslation,
  routes: [
    {
      path: routeSegments.bookTranslation,
      element: <BookTranslationPage />,
    },
  ],
};
