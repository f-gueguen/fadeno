export const MORPH_PROJECTS = ["chromium", "firefox", "webkit"] as const;

export type MorphProject = (typeof MORPH_PROJECTS)[number];
