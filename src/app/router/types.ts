import type { RouteObject } from "react-router-dom";

export interface AppModuleDefinition {
  key: string;
  title: string;
  description: string;
  href: string;
  routes: RouteObject[];
}
