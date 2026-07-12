import { createUnsafeHtml } from "./internal/unsafe-html.js";

export type Handler = (request: Request) => Response | Promise<Response>;

declare const unsafeHtmlBrand: unique symbol;

export interface UnsafeHtml {
  readonly [unsafeHtmlBrand]: true;
}

export function unsafeHtml<const Reason extends string>(
  html: string,
  options: { readonly reason: Reason extends "" ? never : Reason },
): UnsafeHtml {
  return createUnsafeHtml(html, options.reason) as UnsafeHtml;
}

export interface RouteConfig {
  readonly root: string;
}

export interface FadenoConfig {
  readonly routes?: RouteConfig;
}

type NoExtra<Actual, Expected> = Actual & Record<Exclude<keyof Actual, keyof Expected>, never>;
type ExactConfig<Config extends FadenoConfig> = NoExtra<Config, FadenoConfig> &
  (Config extends { readonly routes: infer Routes extends RouteConfig }
    ? { readonly routes: NoExtra<Routes, RouteConfig> }
    : unknown);

export function defineConfig<const Config extends FadenoConfig>(config: ExactConfig<Config>): Config {
  return config;
}
