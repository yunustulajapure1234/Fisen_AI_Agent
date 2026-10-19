import Groq from "groq-sdk";
import { searchDocuments } from "./prepare.js";

const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
let groqClient = null;

const FISEN_IDENTITY_ANSWER = 
`I am the **Official AI Assistant of FISEN Group**, developed by **FISEN Technologies**.

FISEN Group operates through two specialized business verticals:

1. **FISEN Automations** – Focused on industrial automation, control systems, and plant engineering.

2. **FISEN Technologies** – Focused on enterprise software, cloud computing, and intelligent digital solutions.

My role is to provide accurate, professional, and reliable information about both business verticals, their services, products, and capabilities.

I serve as a digital knowledge assistant for clients, partners, and employees, helping them access relevant information about FISEN Group.

**Developed by FISEN Technologies. Serving the entire FISEN Group.**`;

function isIdentityQuestion(question) {
    const text = question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    return (
        /^(who\s+are\s+(you|u)|what\s*(is|s)\s+(your|ur)\s+name|who\s+(developed|created|made|built)\s+(you|u)|what\s*(is|s)\s+(your|ur)\s+role|tell\s+me\s+about\s+yourself|introduce\s+yourself|what\s+do\s+(you|u)\s+do|who\s+r\s+u)$/i.test(text)
    );
}

export async function answerQuestion(question) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is missing from backend/.env.");
    }

    if (isIdentityQuestion(question)) {
        return {
            answer: FISEN_IDENTITY_ANSWER,
            sources: [],
        };
    }

    let context = "";
    try {
        const relevantChunks = await searchDocuments(question, 3);
        if (relevantChunks.length > 0) {
            context = relevantChunks
                .map((chunk) => `[Page ${chunk.metadata.pageNumber}]\n${chunk.pageContent}`)
                .join("\n\n");
        }
    } catch (error) {
        console.warn("Document search unavailable:", error.message);
    }

    groqClient ??= new Groq({ apiKey: process.env.GROQ_API_KEY });
    const userMessageContent = context
        ? `FISEN document context:\n${context}\n\nQuestion: ${question}`
        : `Question: ${question}`;
    const completion = await groqClient.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 1000,
        messages: [
            {
                role: "system",
                content:
                    "You are the Official AI Assistant of FISEN Group, developed by FISEN Technologies.\n\n" +
                    "Identity Definition:\n" +
                    "When asked who you are, what your name is, or what your role is, always state:\n" +
                    "\"" + FISEN_IDENTITY_ANSWER + "\"\n\n" +
                    "Operational Rules:\n" +
                    "- Answer questions clearly, concisely, and professionally on behalf of the FISEN Group and its verticals (including FISEN Technologies and FISEN Automation) using facts directly supported by the provided FISEN documentation.\n" +
                    "- Structure answers with clear bullet points, bold key terms, and short readable sections.\n" +
                    "- Do NOT include page numbers, PDF mentions, or citations (such as [Page N], [PDF p. N], or 'according to the PDF'). Speak directly and authoritatively on behalf of FISEN.\n" +
                    "- Avoid large or awkward Markdown tables unless specifically requested.\n" +
                    "- If a requested detail is not specified in the documentation, politely state that this information is currently not available.\n" +
                    "- Maintain a high-end corporate tone suitable for enterprise engineering clients.",
            },
            {
                role: "user",
                content: userMessageContent,
            },
        ],
    });

    const answer = completion.choices[0]?.message?.content;
    if (typeof answer !== "string" || answer.length === 0) {
        throw new Error("Groq returned an empty answer.");
    }

    return { answer, sources: [] };
}
