export const routeSegments = {
  bookTranslation: "book-translation",
} as const;

export const routePaths = {
  home: "/",
  bookTranslation: `/${routeSegments.bookTranslation}`,
} as const;
