import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  // The session is now stored in the DB with a valid access token
  return Response.redirect(new URL("/app", request.url).toString());
}
