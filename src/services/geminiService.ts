import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

export async function generateChatResponse(prompt: string) {
  try {
    if (!ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("Gemini API key is missing. AI features will not work.");
        return "Sorry, AI features are currently disabled because the API key is missing.";
      }
      ai = new GoogleGenAI({ apiKey });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Sorry, I'm having trouble thinking right now.";
  }
}
