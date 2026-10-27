import { prisma } from "~/db.server";

/** Health check for the hosting platform: the server is up and the database answers. */
export async function loader() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("database unavailable", { status: 503 });
  }
}
