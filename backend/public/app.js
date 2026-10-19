const form = document.querySelector("#chat-form");
const input = document.querySelector("#question");
const sendButton = document.querySelector("#send-button");
const charCount = document.querySelector("#char-count");
const welcome = document.querySelector("#welcome");
const messages = document.querySelector("#messages");

let isSending = false;
let lastQuestion = "";

function renderAssistantAnswer(content, answer) {
    if (!window.marked || !window.DOMPurify) {
        throw new Error("The Markdown renderer could not be loaded. Please refresh and try again.");
    }

    content.replaceChildren();
    const markdown = document.createElement("div");
    markdown.className = "markdown-body";

    // Strip any [Page N], [PDF p. N], 【PDF p. N】 citations completely
    const cleanAnswer = answer
        .replace(/(?:\[|【)\s*(?:PDF\s*p\.?|Page)\s*[0-9]+[a-z0-9\s,\-–—]*\s*(?:\]|】)/gi, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    const rawHtml = window.marked.parse(cleanAnswer, { gfm: true });

    markdown.innerHTML = window.DOMPurify.sanitize(rawHtml, {
        ADD_ATTR: ['target', 'rel']
    });

    for (const link of markdown.querySelectorAll("a")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    content.append(markdown);
}

function scrollToLatest() {
    messages.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addMessage(role, text, sources = []) {
    const article = document.createElement("article");
    article.className = `message ${role}`;

    if (role === "assistant") {
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = "F";
        article.append(avatar);
    }

    const content = document.createElement("div");
    content.className = "message-content";
    if (role === "assistant" && text) renderAssistantAnswer(content, text);
    else content.textContent = text;

    article.append(content);
    messages.append(article);
    scrollToLatest();
    return content;
}

const DEFAULT_PLACEHOLDER = "Ask anything about FISEN...";

function setSending(sending) {
    isSending = sending;
    sendButton.disabled = sending;
    sendButton.querySelector("span").textContent = sending ? "Thinking" : "Send";
    input.disabled = sending;
    input.placeholder = sending ? "FISEN Assistant is thinking..." : DEFAULT_PLACEHOLDER;
}

async function sendQuestion(question) {
    const trimmed = typeof question === "string" ? question.trim() : "";
    if (isSending || !trimmed) return;

    welcome.hidden = true;
    lastQuestion = trimmed;

    // Immediately clear searchbar and reset height & counter
    input.value = "";
    updateInput();

    addMessage("user", lastQuestion);
    const answerContainer = addMessage("assistant", "");
    const typing = document.createElement("div");
    typing.className = "typing";
    typing.setAttribute("aria-label", "Assistant is searching and preparing an answer");
    for (let dot = 0; dot < 3; dot += 1) {
        typing.append(document.createElement("span"));
    }
    answerContainer.append(typing);
    setSending(true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: lastQuestion }),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "The request could not be completed.");
        }

        typing.remove();
        renderAssistantAnswer(
            answerContainer,
            typeof result.answer === "string" ? result.answer : ""
        );
    } catch (error) {
        typing.remove();
        answerContainer.classList.add("error-message");
        answerContainer.textContent = error.message;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "retry-button";
        retry.textContent = "Try again";
        retry.addEventListener("click", () => {
            answerContainer.closest(".message")?.remove();
            const previousQuestion = messages.querySelector(".message.user:last-of-type");
            previousQuestion?.remove();
            void sendQuestion(lastQuestion);
        }, { once: true });
        answerContainer.append(document.createElement("br"), retry);
    } finally {
        setSending(false);
        updateInput();
        input.focus();
        scrollToLatest();
    }
}

function updateInput() {
    charCount.textContent = `${input.value.length} / 2000`;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    sendButton.disabled = isSending || input.value.trim().length === 0;
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value;
    if (!question.trim()) return;
    input.value = "";
    updateInput();
    void sendQuestion(question);
});

input.addEventListener("input", updateInput);
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
        const prompt = button.dataset.prompt || "";
        input.value = "";
        updateInput();
        void sendQuestion(prompt);
    });
});

updateInput();
