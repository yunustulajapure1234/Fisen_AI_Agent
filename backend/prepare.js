import "dotenv/config";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone";
import { OllamaEmbeddings } from "@langchain/ollama";
import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const INDEX_NAME = process.env.PINECONE_INDEX ?? "companychat-local";
const INDEX_DIMENSION = Number(process.env.PINECONE_DIMENSION ?? 768);
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
const SOURCE_ID = process.env.SOURCE_ID ?? "fisen-company-profile-detailed";
const REQUIRED_SECTIONS = [
    "FISEN Group Structure and Positioning",
    "FISEN Automation",
    "FISEN Technologies",
    "Industries and example solution themes",
];
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const pineconeRegion = {
    cloud: process.env.PINECONE_CLOUD ?? "aws",
    region: process.env.PINECONE_REGION ?? "us-east-1",
};

export const embeddings = new OllamaEmbeddings({
    model: EMBEDDING_MODEL,
    baseUrl: OLLAMA_BASE_URL,
});

let pineconeClient;
let cachedPineconeIndex = null;
let cachedVectorStore = null;

function getPineconeClient() {
    if (!process.env.PINECONE_API_KEY) {
        throw new Error("PINECONE_API_KEY is missing from backend/.env.");
    }

    pineconeClient ??= new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    return pineconeClient;
}

async function getPineconeIndex() {
    if (cachedPineconeIndex) {
        return cachedPineconeIndex;
    }

    const pinecone = getPineconeClient();
    cachedPineconeIndex = pinecone.index(INDEX_NAME);
    return cachedPineconeIndex;
}

function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function extractProfilePages(filepath) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: await readFile(filepath) });
    let info;
    let extracted;
    try {
        info = await parser.getInfo();
        extracted = await parser.getText();
    } finally {
        await parser.destroy();
    }

    const pages = extracted.pages.map((page, index) => ({
        pageNumber: page.num ?? index + 1,
        text: page.text.trim(),
    }));
    const fullText = pages.map((page) => page.text).join("\n");
    const normalizedText = normalizeText(fullText);
    const missingSections = REQUIRED_SECTIONS.filter(
        (section) => !normalizedText.includes(normalizeText(section))
    );

    console.log(`Extracted ${pages.length} of ${info.total} PDF pages (${fullText.length} text characters).`);
    for (const section of REQUIRED_SECTIONS) {
        console.log(`${normalizedText.includes(normalizeText(section)) ? "Found" : "Missing"} section: ${section}`);
    }

    if (pages.length !== info.total) {
        throw new Error(`PDF page extraction returned ${pages.length} pages; expected ${info.total}.`);
    }
    if (pages.every((page) => page.text.length === 0)) {
        throw new Error(`No readable text could be extracted from "${filepath}".`);
    }
    if (missingSections.length > 0) {
        throw new Error(
            `PDF text verification failed. Missing required section(s): ${missingSections.join("; ")}.`
        );
    }

    return pages;
}

function makeProfileChunks(pages, filename) {
    const pageDocuments = pages
        .filter((page) => page.text.length > 0)
        .map((page) => new Document({
            pageContent: page.text,
            metadata: {
                sourceId: SOURCE_ID,
                sourceFile: filename,
                pageNumber: page.pageNumber,
            },
        }));
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 900,
        chunkOverlap: 150,
    });

    return splitter.splitDocuments(pageDocuments);
}

async function verifyStoredVectors(index, ids, expectedDimension) {
    const batches = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
        batches.push(ids.slice(offset, offset + 100));
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const records = await Promise.all(batches.map((batch) => index.fetch(batch)));
        const verifiedCount = records.reduce(
            (total, { records: fetched }) => total + Object.values(fetched).filter(
                (record) => record.values?.length === expectedDimension
            ).length,
            0
        );

        if (verifiedCount === ids.length) {
            return verifiedCount;
        }
        if (attempt < 9) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    throw new Error(`Pinecone did not return all ${ids.length} uploaded vectors with ${expectedDimension} dimensions.`);
}

export async function indexCompanyProfile(filepath) {
    const filename = basename(filepath);
    const pages = await extractProfilePages(filepath);
    const chunks = await makeProfileChunks(pages, filename);
    if (chunks.length === 0) {
        throw new Error(`No text chunks were generated from "${filepath}".`);
    }
    console.log(`Split the verified profile into ${chunks.length} page-aware chunks.`);

    let vectors;
    try {
        vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.pageContent));
    } catch (error) {
        throw new Error(
            `Ollama embedding generation failed. Start Ollama and run "ollama pull ${EMBEDDING_MODEL}".`,
            { cause: error }
        );
    }
    if (vectors.length !== chunks.length) {
        throw new Error(`Ollama returned ${vectors.length} embeddings for ${chunks.length} chunks.`);
    }
    const invalidVector = vectors.find((vector) => vector.length !== INDEX_DIMENSION);
    if (invalidVector) {
        throw new Error(
            `Ollama model "${EMBEDDING_MODEL}" returned ${invalidVector.length} dimensions; ` +
            `expected ${INDEX_DIMENSION}.`
        );
    }

    const pineconeIndex = await getPineconeIndex();
    const namespace = pineconeIndex.namespace();
    const vectorStore = new PineconeStore(embeddings, { pineconeIndex });
    const nextChunkByPage = new Map();
    const ids = chunks.map((chunk) => {
        const pageNumber = chunk.metadata.pageNumber;
        const chunkNumber = nextChunkByPage.get(pageNumber) ?? 0;
        nextChunkByPage.set(pageNumber, chunkNumber + 1);
        return `${SOURCE_ID}-p${pageNumber}-c${chunkNumber}`;
    });

    console.log(`Replacing only existing vectors for "${filename}"...`);
    await namespace.deleteMany({ sourceId: SOURCE_ID });
    await namespace.deleteMany({ sourceFile: filename });

    const uploadedIds = await vectorStore.addVectors(vectors, chunks, { ids });
    if (uploadedIds.length !== chunks.length) {
        throw new Error(`Pinecone accepted ${uploadedIds.length} vector IDs for ${chunks.length} chunks.`);
    }

    const verifiedCount = await verifyStoredVectors(pineconeIndex, uploadedIds, INDEX_DIMENSION);
    console.log(`Verified ${verifiedCount}/${chunks.length} profile vectors in "${INDEX_NAME}".`);
}

export async function searchLocalText(query, k = 3) {
    try {
        const dataPath = fileURLToPath(new URL("./fisen_profile_text.json", import.meta.url));
        const raw = await readFile(dataPath, "utf8");
        const pages = JSON.parse(raw);
        const terms = query
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 2);

        const scored = pages
            .map((page) => {
                const text = page.text.toLowerCase();
                let score = 0;
                for (const term of terms) {
                    const count = text.split(term).length - 1;
                    score += count;
                }
                return {
                    pageContent: page.text,
                    metadata: { pageNumber: page.page },
                    score,
                };
            })
            .sort((a, b) => b.score - a.score);

        return scored.slice(0, k);
    } catch (err) {
        console.warn("searchLocalText fallback failed:", err.message);
        return [];
    }
}

export async function searchDocuments(query, k = 3) {
    if (typeof query !== "string" || query.trim().length === 0) {
        throw new Error("A non-empty query is required.");
    }

    // On Vercel or when Ollama is unreachable, immediately use fast local text search
    if (process.env.VERCEL || !process.env.PINECONE_API_KEY) {
        return searchLocalText(query, k);
    }

    // Race Pinecone/Ollama against a 1.5-second timeout so requests are always lightning fast
    try {
        const pineconePromise = (async () => {
            const pineconeIndex = await getPineconeIndex();
            cachedVectorStore ??= await PineconeStore.fromExistingIndex(embeddings, {
                pineconeIndex,
                filter: { sourceId: SOURCE_ID },
            });
            const results = await cachedVectorStore.similaritySearch(query, k);
            const uniqueResults = new Map();
            for (const document of results) {
                const key = `${document.metadata.pageNumber}:${normalizeText(document.pageContent)}`;
                if (!uniqueResults.has(key)) {
                    uniqueResults.set(key, document);
                }
            }
            return [...uniqueResults.values()].slice(0, k);
        })();

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Pinecone vector search timed out")), 1500)
        );

        return await Promise.race([pineconePromise, timeoutPromise]);
    } catch (error) {
        console.warn("Pinecone vector search unavailable or timed out, using instant local text search:", error.message);
        return searchLocalText(query, k);
    }
}
