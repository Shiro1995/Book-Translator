import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RootLayout } from "@/app/layouts/RootLayout";
import HomePage from "@/app/pages/HomePage";
import NotFoundPage from "@/app/pages/NotFoundPage";
import RequestHistoryPage from "@/app/pages/RequestHistoryPage";
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
      {
        path: routePaths.requestHistory,
        element: <RequestHistoryPage />,
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
