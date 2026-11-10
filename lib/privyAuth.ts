import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivyClient, verifyPrivyAccessToken } from "@/lib/privyServer";

export const PRIVY_SESSION_COOKIE = "wraith_privy_session";

type AuthenticatedSession = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
  };
};

export async function getPrivySession(
  request?: Request,
): Promise<AuthenticatedSession | null> {
  const authorization = request?.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token =
    bearerToken ?? (await cookies()).get(PRIVY_SESSION_COOKIE)?.value ?? null;
  if (!token) return null;
  const claims = await verifyPrivyAccessToken(token);
  const privyClient = getPrivyClient();
  if (!claims || !privyClient) return null;

  const db = await getDb();
  const users = db.collection("users");
  let user = await users.findOne({ privyUserId: claims.userId });
  if (!user) {
    const privyUser = await privyClient.getUser(claims.userId);
    const email = privyUser.email?.address ?? privyUser.google?.email ?? null;
    const name = privyUser.google?.name ?? null;

    if (email) {
      const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      user = await users.findOne({
        email: { $regex: `^${escapedEmail}$`, $options: "i" },
      });
    }
    if (user) {
      await users.updateOne(
        { _id: user._id },
        { $set: { privyUserId: claims.userId } },
      );
    } else {
      const _id = new ObjectId();
      await users.updateOne(
        { privyUserId: claims.userId },
        {
          $setOnInsert: {
            _id,
            privyUserId: claims.userId,
            ...(email ? { email: email.toLowerCase() } : {}),
            name,
            image: null,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      user = await users.findOne({ privyUserId: claims.userId });
    }
  }

  if (!user?._id) {
    throw new Error("Could not resolve the authenticated Privy account.");
  }

  return {
    user: {
      id: user._id.toString(),
      email: typeof user.email === "string" ? user.email : null,
      name: typeof user.name === "string" ? user.name : null,
      image: typeof user.image === "string" ? user.image : null,
    },
  };
}
