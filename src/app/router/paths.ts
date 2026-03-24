export const routeSegments = {
  modules: "modules",
  bookTranslation: "book-translation",
} as const;

export const routePaths = {
  home: "/",
  modules: `/${routeSegments.modules}`,
  bookTranslation: `/${routeSegments.bookTranslation}`,
} as const;
