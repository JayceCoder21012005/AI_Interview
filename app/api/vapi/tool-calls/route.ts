import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const payload = await req.json();

  const toolCallList = payload?.message?.toolCallList ?? [];

  const results = await Promise.all(
    toolCallList.map(async (toolCall: any) => {
      const toolCallId = toolCall.id;
      const name = toolCall?.function?.name;
      const args = toolCall?.function?.arguments ?? {};

      if (name !== "generate_interview") {
        return {
          toolCallId,
          result: { success: false, error: "Unknown tool" },
        };
      }

      // call your existing endpoint that creates the interview in Firestore
      const r = await fetch(
        "https://ai-interview-mu-two.vercel.app/api/vapi/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        }
      );

      const data = await r.json();

      return { toolCallId, result: data };
    })
  );

  return NextResponse.json({ results });
}