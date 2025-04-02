import { GithubRepoLoader } from "@langchain/community/document_loaders/web/github";
import { generateEmbedding, summariseCode } from "./gemini";
import { db } from "@/server/db";

export const loadGithubRepo = async (
  githubUrl: string,
  githubToken?: string,
) => {
  const loader = new GithubRepoLoader(githubUrl, {
    accessToken: githubToken || "",
    branch: "main",
    ignoreFiles: [
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lockb",
    ],
    recursive: true,
    unknown: "warn",
    maxConcurrency: 5,
  });

  const docs = await loader.load();
  return docs;
};

export const indexGithubRepo = async (
  projectId: string,
  githubUrl: string,
  githubToken?: string,
) => {
  const docs = await loadGithubRepo(githubUrl, process.env.GITHUB_TOKEN);
  const allEmbeddings = await generateEmbeddings(docs);
  await Promise.allSettled(
    allEmbeddings.map(async (embedding, index) => {
      console.log(`processing ${index} of ${allEmbeddings.length}`);
      if (!embedding) return;

      const sourceCodeEmbedding = await db.sourceCodeEmbedding.create({
        data: {
          summary: embedding.summary,
          sourceCode: embedding.sourceCode,
          fileName: embedding.fileName,
          projectId,
        },
      });

      await db.$executeRaw`
        UPDATE "SourceCodeEmbedding"
        SET "summaryEmbedding" = ${embedding.embedding}::vector
        WHERE "id" = ${sourceCodeEmbedding.id}
      `;
    }),
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 5000,
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn(); // If success, return result
    } catch (err: any) {
      attempt++;
      console.warn(`⚠️ Attempt ${attempt} failed: ${err.message}`);
      if (attempt >= maxRetries) {
        console.error(`❌ Failed after ${maxRetries} attempts`);
        throw err;
      }
      const delay = baseDelayMs * attempt;
      console.log(`⏳ Retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
  throw new Error("Retry attempts exhausted");
}

const generateEmbeddings = async (docs: Document[]) => {
  const embeddings = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    console.log(`Processing ${i + 1} of ${docs.length}`);
    try {
      const summary = await retryWithBackoff(
        () => summariseCode(doc),
        3,
        10000,
      );
      const embedding = await retryWithBackoff(
        () => generateEmbedding(summary),
        3,
        10000,
      );

      embeddings.push({
        summary,
        embedding,
        sourceCode: JSON.parse(JSON.stringify(doc.pageContent)),
        fileName: doc.metadata.source,
      });
    } catch (err) {
      console.error(`❌ Skipping ${doc.metadata.source} after retries`);
    }
  }

  return embeddings;
};
