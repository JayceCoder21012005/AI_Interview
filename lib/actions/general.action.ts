"use server";

import { generateObject } from "ai";
import { google } from "@ai-sdk/google";

import { db } from "@/firebase/admin";
import { feedbackSchema } from "@/constants";

const FALLBACK_CATEGORY_SCORES = [
  "Communication Skills",
  "Technical Knowledge",
  "Problem Solving",
  "Cultural Fit",
  "Confidence and Clarity",
].map((name) => ({
  name,
  score: 0,
  comment:
    "Automated scoring is temporarily unavailable due to AI provider limits.",
}));

const toValidScore = (score: number) => {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
};

const calculateTotalScore = (
  categoryScores: Array<{ score: number }>
): number => {
  if (categoryScores.length === 0) return 0;

  const total = categoryScores.reduce(
    (sum, category) => sum + toValidScore(category.score),
    0
  );

  return Math.round(total / categoryScores.length);
};

const isQuotaError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    statusCode?: number;
    message?: string;
    responseBody?: string;
    lastError?: { statusCode?: number; message?: string; responseBody?: string };
  };

  const message = candidate.message?.toLowerCase() ?? "";
  const body = candidate.responseBody?.toLowerCase() ?? "";
  const lastErrorMessage = candidate.lastError?.message?.toLowerCase() ?? "";
  const lastErrorBody = candidate.lastError?.responseBody?.toLowerCase() ?? "";

  return (
    candidate.statusCode === 429 ||
    candidate.lastError?.statusCode === 429 ||
    message.includes("quota") ||
    body.includes("resource_exhausted") ||
    lastErrorMessage.includes("quota") ||
    lastErrorBody.includes("resource_exhausted")
  );
};

const buildFallbackFeedback = ({
  interviewId,
  userId,
  quotaExceeded,
}: {
  interviewId: string;
  userId: string;
  quotaExceeded: boolean;
}) => ({
  interviewId,
  userId,
  totalScore: 0,
  categoryScores: FALLBACK_CATEGORY_SCORES,
  strengths: ["Interview completed successfully."],
  areasForImprovement: [
    "Detailed AI-generated feedback is temporarily unavailable.",
  ],
  finalAssessment: quotaExceeded
    ? "Detailed feedback is temporarily unavailable because the AI provider quota has been exceeded. Please try again later."
    : "Detailed feedback could not be generated at this time. Please try again later.",
  createdAt: new Date().toISOString(),
});

export async function createFeedback(params: CreateFeedbackParams) {
  const { interviewId, userId, transcript, feedbackId } = params;

  const feedbackRef = feedbackId
    ? db.collection("feedback").doc(feedbackId)
    : db.collection("feedback").doc();

  try {
    const formattedTranscript = transcript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    const { object } = await generateObject({
      model: google("gemini-2.5-flash", {
        structuredOutputs: false,
      }),
      maxRetries: 0,
      schema: feedbackSchema,
      prompt: `
        You are an AI interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories. Be thorough and detailed in your analysis. Don't be lenient with the candidate. If there are mistakes or areas for improvement, point them out.
        Transcript:
        ${formattedTranscript}

        Please score the candidate from 0 to 100 in the following areas. Do not add categories other than the ones provided:
        - **Communication Skills**: Clarity, articulation, structured responses.
        - **Technical Knowledge**: Understanding of key concepts for the role.
        - **Problem-Solving**: Ability to analyze problems and propose solutions.
        - **Cultural & Role Fit**: Alignment with company values and job role.
        - **Confidence & Clarity**: Confidence in responses, engagement, and clarity.
        `,
      system:
        "You are a professional interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories",
    });

    const feedback = {
      interviewId: interviewId,
      userId: userId,
      totalScore: calculateTotalScore(object.categoryScores),
      categoryScores: object.categoryScores,
      strengths: object.strengths,
      areasForImprovement: object.areasForImprovement,
      finalAssessment: object.finalAssessment,
      createdAt: new Date().toISOString(),
    };

    await feedbackRef.set(feedback);

    return { success: true, feedbackId: feedbackRef.id };
  } catch (error) {
    const quotaExceeded = isQuotaError(error);

    if (quotaExceeded) {
      console.warn(
        "AI feedback generation quota exceeded. Falling back to default feedback."
      );
    } else {
      console.error("Error saving feedback:", error);
    }

    const fallbackFeedback = buildFallbackFeedback({
      interviewId,
      userId,
      quotaExceeded,
    });

    try {
      await feedbackRef.set(fallbackFeedback);

      if (quotaExceeded) {
        console.warn(
          "Saved fallback feedback because AI provider quota was exceeded."
        );
      }

      return {
        success: true,
        feedbackId: feedbackRef.id,
        degraded: true,
        reason: quotaExceeded ? "quota_exceeded" : "feedback_generation_failed",
      };
    } catch (fallbackError) {
      console.error("Error saving fallback feedback:", fallbackError);
      return { success: false };
    }
  }
}

export async function getInterviewById(id: string): Promise<Interview | null> {
  const interview = await db.collection("interviews").doc(id).get();

  return interview.data() as Interview | null;
}

export async function getFeedbackByInterviewId(
  params: GetFeedbackByInterviewIdParams
): Promise<Feedback | null> {
  const { interviewId, userId } = params;

  const querySnapshot = await db
    .collection("feedback")
    .where("interviewId", "==", interviewId)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (querySnapshot.empty) return null;

  const feedbackDoc = querySnapshot.docs[0];
  return { id: feedbackDoc.id, ...feedbackDoc.data() } as Feedback;
}

export async function getLatestInterviews(
  params: GetLatestInterviewsParams
): Promise<Interview[] | null> {
  const { userId, limit = 20 } = params;

  const interviews = await db
    .collection("interviews")
    .orderBy("createdAt", "desc")
    .where("finalized", "==", true)
    .where("userId", "!=", userId)
    .limit(limit)
    .get();

  return interviews.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Interview[];
}

export async function getInterviewsByUserId(
  userId: string
): Promise<Interview[] | null> {
  const interviews = await db
    .collection("interviews")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return interviews.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Interview[];
}
