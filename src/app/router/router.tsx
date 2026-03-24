import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RootLayout } from "@/app/layouts/RootLayout";
import ModuleHubPage from "@/app/pages/ModuleHubPage";
import NotFoundPage from "@/app/pages/NotFoundPage";
import { appModules } from "@/app/router/modules";
import { routePaths, routeSegments } from "@/app/router/paths";

const router = createBrowserRouter([
  {
    path: routePaths.home,
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Navigate to={routePaths.bookTranslation} replace />,
      },
      {
        path: routeSegments.modules,
        element: <ModuleHubPage />,
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
