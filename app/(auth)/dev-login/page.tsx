import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { DevProfilePicker } from "@/components/auth/dev-profile-picker";

interface PageProps {
  searchParams: Promise<{ redirect?: string }>;
}

export default async function DevLoginPage({ searchParams }: PageProps) {
  if (process.env.LOCAL_DEV !== "true") notFound();

  const { redirect } = await searchParams;

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));

  return (
    <>
      <h2 className="mb-6 text-center text-2xl font-bold text-lingo-text">
        Choose a Profile
      </h2>
      <DevProfilePicker users={users} redirectUrl={redirect} />
    </>
  );
}
