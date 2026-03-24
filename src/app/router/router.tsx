import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RootLayout } from "@/app/layouts/RootLayout";
import HomePage from "@/app/pages/HomePage";
import NotFoundPage from "@/app/pages/NotFoundPage";
import { appModules } from "@/app/router/modules";
import { routePaths } from "@/app/router/paths";

const router = createBrowserRouter([
  {
    path: routePaths.home,
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      ...appModules.flatMap((moduleItem) => moduleItem.routes),
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);

export function AppRouterProvider() {
  return <RouterProvider router={router} />;
}
