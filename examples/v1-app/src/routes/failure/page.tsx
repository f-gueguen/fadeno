import type { Page } from "fadeno-framework-internal";

const page: Page = () => {
  throw new Error("deliberate private failure details");
};

export default page;
