declare module "server-only:secrets" {
  export const secret: string;
}

declare module "server-only:database" {
  export const database: { query(source: string): unknown };
}
