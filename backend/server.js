import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { answerQuestion } from "./assistant.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const frontendPath = fileURLToPath(new URL("./public/", import.meta.url));

if (process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

// Security headers with CSP tailored for fonts and icons
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
            },
        },
    })
);

// CORS configuration (defaults to all, or restricted via CORS_ORIGIN env)
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : "*";
app.use(cors({ origin: allowedOrigins }));

app.use(express.json({ limit: "16kb" }));
app.use(express.static(frontendPath, { maxAge: "1h" }));

// Rate-limiting for chat endpoint to protect against abuse and API quotas
const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX ?? 60),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many messages sent. Please wait a minute before asking again." },
});

// Fallback vendor routes if node_modules is needed
app.get("/vendor/marked.umd.js", (_request, response) => {
    response.sendFile(fileURLToPath(new URL("./public/vendor/marked.umd.js", import.meta.url)));
});

app.get("/vendor/purify.min.js", (_request, response) => {
    response.sendFile(fileURLToPath(new URL("./public/vendor/purify.min.js", import.meta.url)));
});

app.get("/api/health", (_request, response) => {
    response.json({
        status: "ok",
        service: "FISEN Group AI Assistant",
        timestamp: new Date().toISOString(),
    });
});

app.post("/api/chat", chatLimiter, async (request, response) => {
    const question = request.body?.question;
    if (typeof question !== "string" || question.trim().length === 0) {
        return response.status(400).json({ error: "Please enter a question." });
    }
    if (question.length > 2000) {
        return response.status(400).json({ error: "Please keep questions under 2,000 characters." });
    }

    try {
        const result = await answerQuestion(question.trim());
        return response.json(result);
    } catch (error) {
        console.error("Chat request failed:", error.message);
        return response.status(500).json({
            error: "I couldn't answer that right now. Please try again in a few moments.",
        });
    }
});

// Catch-all 404 for undefined API endpoints
app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Endpoint not found." });
});

const server = app.listen(port, host, () => {
    console.log(`FISEN Group AI Assistant is running on http://${host}:${port}`);
});

// Graceful shutdown
const shutdown = (signal) => {
    console.log(`\nReceived ${signal}. Shutting down server gracefully...`);
    server.close(() => {
        console.log("Server stopped.");
        process.exit(0);
    });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
