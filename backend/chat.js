import "dotenv/config";
import { resolve } from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { answerQuestion } from "./assistant.js";

export async function chatWithGroq() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        console.log('RAG chat is ready. Ask a question, or type "/bye" to quit.');
        rl.setPrompt("you: ");
        rl.prompt();

        for await (const input of rl) {
            const question = input.trim();
            if (question === "/bye") {
                break;
            }
            if (!question) {
                rl.prompt();
                continue;
            }

            const { answer } = await answerQuestion(question);
            console.log(`assistant: ${answer}`);
            rl.prompt();
        }
    } finally {
        rl.close();
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    try {
        await chatWithGroq();
    } catch (error) {
        console.error("Chat failed:", error);
        process.exitCode = 1;
    }
}
