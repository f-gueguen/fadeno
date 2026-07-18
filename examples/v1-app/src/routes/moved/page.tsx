import { redirect, type Page } from "@fadeno/framework";

const page: Page = () => redirect("/hello/Redirected");

export default page;
