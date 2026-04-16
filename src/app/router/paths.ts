export const routeSegments = {
  bookTranslation: "book-translation",
  requestHistory: "request-history",
} as const;

export const routePaths = {
  home: "/",
  bookTranslation: `/${routeSegments.bookTranslation}`,
  requestHistory: `/${routeSegments.requestHistory}`,
} as const;
