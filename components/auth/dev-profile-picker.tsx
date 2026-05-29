"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: Date;
}

const AVATAR_COLORS = [
  "bg-lingo-green",
  "bg-lingo-blue",
  "#ff9600",
  "#ce82ff",
  "#ff4b4b",
  "#1cb0f6",
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface Props {
  users: UserProfile[];
  redirectUrl?: string;
}

export function DevProfilePicker({ users, redirectUrl }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");

  const destination = redirectUrl || "/onboarding";

  async function selectUser(userId: string) {
    setLoading(userId);
    const res = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      router.push(destination);
    } else {
      setError("Failed to log in");
      setLoading(null);
    }
  }

  async function createUser() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    const res = await fetch("/api/dev/login", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      router.push(destination);
    } else {
      setError("Failed to create profile");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-center text-sm text-lingo-text-light">
        Local dev mode — pick a profile to continue
      </p>

      <div className="grid grid-cols-2 gap-3">
        {users.map((u) => {
          const color = avatarColor(u.name);
          const isLoading = loading === u.id;
          return (
            <button
              key={u.id}
              onClick={() => selectUser(u.id)}
              disabled={!!loading || creating}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-lingo-border bg-white p-4 hover:border-lingo-green hover:bg-lingo-green/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl font-black"
                style={{ backgroundColor: color.startsWith("bg-") ? undefined : color }}
              >
                {color.startsWith("bg-") ? (
                  <div className={`w-full h-full rounded-full flex items-center justify-center ${color}`}>
                    {u.name[0].toUpperCase()}
                  </div>
                ) : (
                  u.name[0].toUpperCase()
                )}
              </div>
              <span className="font-bold text-lingo-text text-sm truncate w-full text-center">
                {isLoading ? (
                  <span className="inline-flex items-center gap-1 justify-center">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading…
                  </span>
                ) : (
                  u.name
                )}
              </span>
            </button>
          );
        })}

        {/* New profile card */}
        <button
          onClick={() => setShowCreate(true)}
          disabled={!!loading || creating}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-lingo-border bg-white p-4 hover:border-lingo-green hover:bg-lingo-green/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-lingo-gray text-lingo-text-light text-3xl font-light">
            +
          </div>
          <span className="font-bold text-lingo-text-light text-sm">New Profile</span>
        </button>
      </div>

      {showCreate && (
        <div className="space-y-3 rounded-2xl border-2 border-lingo-border p-4">
          <p className="text-sm font-bold text-lingo-text">New profile name</p>
          <input
            autoFocus
            type="text"
            placeholder="e.g. Alice"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createUser()}
            className="w-full rounded-xl border-2 border-lingo-border px-3 py-2 text-sm focus:outline-none focus:border-lingo-green"
          />
          <div className="flex gap-2">
            <button
              onClick={createUser}
              disabled={creating || !newName.trim()}
              className="flex-1 rounded-xl bg-lingo-green py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(""); }}
              className="rounded-xl border-2 border-lingo-border px-4 py-2 text-sm font-bold text-lingo-text-light hover:bg-lingo-gray/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-center text-sm text-lingo-red font-medium">{error}</p>}
    </div>
  );
}
