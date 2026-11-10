import { getPrivySession } from "@/lib/privyAuth";

export async function getAppSession(request?: Request) {
  return getPrivySession(request);
}
