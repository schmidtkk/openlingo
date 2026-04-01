import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  const language = formData.get("language");

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }
  if (!language || typeof language !== "string") {
    return NextResponse.json({ error: "language is required" }, { status: 400 });
  }

  const file = new File([audio], "recording.webm", { type: audio.type || "audio/webm" });

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language,
  });

  return NextResponse.json({ text: transcription.text });
}
