export type Handler = (request: Request) => Response | Promise<Response>;
export type PrototypeWebHandler = Handler;
