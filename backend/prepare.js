import "dotenv/config";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
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

function getPineconeClient() {
    if (!process.env.PINECONE_API_KEY) {
        throw new Error("PINECONE_API_KEY is missing from backend/.env.");
    }

    pineconeClient ??= new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    return pineconeClient;
}

async function getPineconeIndex() {
    const pinecone = getPineconeClient();
    const { indexes = [] } = await pinecone.listIndexes();
    const indexExists = indexes.some((index) => index.name === INDEX_NAME);

    if (!indexExists) {
        console.log(`Creating Pinecone index "${INDEX_NAME}" (${INDEX_DIMENSION} dimensions)...`);
        await pinecone.createIndex({
            name: INDEX_NAME,
            dimension: INDEX_DIMENSION,
            metric: "cosine",
            spec: { serverless: pineconeRegion },
            waitUntilReady: true,
            suppressConflicts: true,
        });
    }

    const description = await pinecone.describeIndex(INDEX_NAME);
    if (description.dimension !== INDEX_DIMENSION) {
        throw new Error(
            `Pinecone index "${INDEX_NAME}" has dimension ${description.dimension}; ` +
            `the ${EMBEDDING_MODEL} model outputs ${INDEX_DIMENSION}. ` +
            "Use a separate index with the matching dimension."
        );
    }
    if (!description.status?.ready) {
        throw new Error(`Pinecone index "${INDEX_NAME}" is not ready yet.`);
    }

    console.log(`Using ready Pinecone index "${INDEX_NAME}" (${description.dimension} dimensions).`);
    return pinecone.index(INDEX_NAME);
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

export async function searchDocuments(query, k = 6) {
    if (typeof query !== "string" || query.trim().length === 0) {
        throw new Error("A non-empty query is required.");
    }

    const pineconeIndex = await getPineconeIndex();
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
        pineconeIndex,
        filter: { sourceId: SOURCE_ID },
    });
    const results = await vectorStore.similaritySearch(query, k * 3);
    const uniqueResults = new Map();
    for (const document of results) {
        const key = `${document.metadata.pageNumber}:${normalizeText(document.pageContent)}`;
        if (!uniqueResults.has(key)) {
            uniqueResults.set(key, document);
        }
    }
    return [...uniqueResults.values()].slice(0, k);
}
