import { requireSession } from "@/lib/auth-server";
import { ChatView } from "@/components/chat/chat-view";
import {
  getTargetLanguage,
  getPreferredModel,
} from "@/lib/actions/preferences";
import { getModelsForUser, resolveModelIdForUser } from "@/lib/ai/models";


export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const session = await requireSession();
  const [language, storedPreferredModel, params] = await Promise.all([
    getTargetLanguage(session.user.id),
    getPreferredModel(session.user.id),
    searchParams,
  ]);

  const availableModels = getModelsForUser(session.user.email);
  const preferredModel = resolveModelIdForUser(
    storedPreferredModel,
    session.user.email,
  );

  return (
    <ChatView
      key={params.prompt ? `prompt-${params.prompt}` : "new"}
      language={language ?? undefined}
      preferredModel={preferredModel}
      availableModels={availableModels}
      initialPrompt={params.prompt}
    />
  );
}
