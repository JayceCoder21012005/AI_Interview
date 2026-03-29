"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { createFeedback } from "@/lib/actions/general.action";

type AgentType = "generate" | "interview";

interface AgentProps {
  userName: string;
  userId?: string;
  interviewId?: string; // REQUIRED when type==="interview"
  feedbackId?: string;
  type: AgentType;
  questions?: string[]; // used when type==="interview"
}

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

type SavedMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type VapiTranscriptMessage = {
  type: "transcript";
  transcriptType: "partial" | "final";
  role: SavedMessage["role"];
  transcript: string;
};

function isFinalTranscriptMessage(msg: unknown): msg is VapiTranscriptMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Partial<VapiTranscriptMessage>;
  return (
    m.type === "transcript" &&
    m.transcriptType === "final" &&
    typeof m.transcript === "string" &&
    (m.role === "user" || m.role === "assistant" || m.role === "system")
  );
}

function isMeetingEndedDailyError(err: unknown) {
  const e = err as any;
  const msg =
    e?.errorMsg || e?.error?.msg || e?.error?.message || e?.message || "";
  return String(msg).toLowerCase().includes("meeting has ended");
}

export default function Agent({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) {
  const router = useRouter();

  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Prevent duplicate feedback generation
  const feedbackTriggeredRef = useRef(false);

  const lastMessage = useMemo(
    () => (messages.length ? messages[messages.length - 1].content : ""),
    [messages]
  );

  const finalizeInterview = async (source: "call-end" | "user-end") => {
    if (feedbackTriggeredRef.current) return;
    feedbackTriggeredRef.current = true;

    // Only generate feedback after an interview call
    if (type !== "interview") {
      router.push("/");
      return;
    }

    if (!interviewId || !userId) {
      console.error("Missing interviewId/userId for feedback", {
        interviewId,
        userId,
        source,
      });
      router.push("/");
      return;
    }

    // Give a small grace period for final transcript messages to arrive
    await new Promise((r) => setTimeout(r, 400));

    if (!messages.length) {
      console.warn("Transcript empty; skipping feedback generation.", { source });
      router.push(`/interview/${interviewId}`);
      return;
    }

    const res = await createFeedback({
      interviewId,
      userId,
      transcript: messages,
      feedbackId,
    });

    console.log("createFeedback result:", res);

    if (res?.success && res?.feedbackId) {
      router.push(`/interview/${interviewId}/feedback`);
    } else {
      router.push(`/interview/${interviewId}`);
    }
  };

  // ---------- Vapi event listeners ----------
  useEffect(() => {
    const onCallStart = () => {
      feedbackTriggeredRef.current = false;
      setMessages([]);
      setCallStatus(CallStatus.ACTIVE);
    };

    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);
      finalizeInterview("call-end");
    };

    const onMessage = (msg: unknown) => {
      if (!isFinalTranscriptMessage(msg)) return;
      setMessages((prev) => [
        ...prev,
        { role: msg.role, content: msg.transcript },
      ]);
    };

    const onSpeechStart = () => setIsSpeaking(true);
    const onSpeechEnd = () => setIsSpeaking(false);

    const onError = (err: unknown) => {
      if (isMeetingEndedDailyError(err)) return;
      console.log("Vapi error:", err);
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, interviewId, userId, feedbackId, messages, router]);

  // ---------- Start call ----------
  const startCall = async () => {
    setCallStatus(CallStatus.CONNECTING);

    try {
      if (type === "generate") {
        const intakeId = process.env.NEXT_PUBLIC_VAPI_INTERVIEW_INTAKE_ID;
        if (!intakeId)
          throw new Error("Missing NEXT_PUBLIC_VAPI_INTERVIEW_INTAKE_ID");
        if (!userId) throw new Error("Missing userId for intake flow");

        await vapi.start(intakeId, {
          variableValues: { userId, username: userName },
        });
        return;
      }

      const runnerId = process.env.NEXT_PUBLIC_VAPI_INTERVIEW_RUNNER_ID;
      if (!runnerId)
        throw new Error("Missing NEXT_PUBLIC_VAPI_INTERVIEW_RUNNER_ID");

      const questionsJson = JSON.stringify(questions ?? []);
      await vapi.start(runnerId, { variableValues: { questions: questionsJson } });
    } catch (err) {
      console.log("Failed to start Vapi call:", err);
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  // ---------- End call (always finalize) ----------
  const endCall = () => {
    vapi.stop();

    // fallback: if call-end doesn't arrive quickly, still finalize
    setTimeout(() => {
      finalizeInterview("user-end");
    }, 1200);
  };

  return (
    <>
      <div className="call-view">
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="ai"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="user"
              width={120}
              height={120}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {!!lastMessage && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== CallStatus.ACTIVE ? (
          <button className="relative btn-call" onClick={startCall}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== CallStatus.CONNECTING && "hidden"
              )}
            />
            <span className="relative">
              {callStatus === CallStatus.INACTIVE || callStatus === CallStatus.FINISHED
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={endCall}>
            End
          </button>
        )}
      </div>
    </>
  );
}