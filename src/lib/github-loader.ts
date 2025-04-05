import { GithubRepoLoader } from "@langchain/community/document_loaders/web/github";
import { generateEmbedding, summariseCode } from "./gemini";
import { db } from "@/server/db";
import { Octokit } from "octokit";

const getFileCount = async (
  path: string,
  octokit: Octokit,
  githubOwner: string,
  githubRepo: string,
  acc: number = 0,
) => {
  try {
    console.log("Getting Content using octokit");
    const { data } = await octokit.rest.repos.getContent({
      owner: githubOwner,
      repo: githubRepo,
      path,
    });
    console.log("Done getting content using octokit");

    if (!Array.isArray(data) && data.type === "file") return acc + 1;

    if (Array.isArray(data)) {
      let fileCount = 0;
      const directories: string[] = [];

      for (const item of data) {
        if (item.type === "dir") {
          directories.push(item.path);
        } else {
          fileCount++;
        }
      }

      const directoryCounts = await Promise.all(
        directories.map((dirPath) =>
          getFileCount(dirPath, octokit, githubOwner, githubRepo, 0),
        ),
      );

      fileCount += directoryCounts.reduce((acc, count) => acc + count, 0);
      return acc + fileCount;
    }

    return acc;
  } catch (error: any) {
    console.log("Inside Error Block in getFileCount function");
    if (
      error?.response?.status === 403 &&
      error.message.includes("rate limit")
    ) {
      throw new Error(
        "⚠️ GitHub API rate limit exceeded. Please wait and try again later.",
      );
    }

    console.error("❌ getFileCount failed:", error.message);
    throw new Error("Failed to fetch GitHub contents.");
  }
};

export const checkCredits = async (githubUrl: string, githubToken?: string) => {
  // find out how many files are in the repo
  const token = githubToken?.trim() || process.env.GITHUB_TOKEN;
  console.log("githubToken =", githubToken);
  console.log(githubToken);
  console.log(".env token =", process.env.GITHUB_TOKEN);
  console.log("token = ", token);
  const octokit = new Octokit({ auth: token });
  console.log("🛠️ Using GitHub Token:", token ? "Yes" : "No"); // Add this for debugging
  const githubOwner = githubUrl.split("/")[3];
  const githubRepo = githubUrl.split("/")[4];
  if (!githubOwner || !githubRepo) {
    return 0;
  }
  try {
    console.log("Trying get file count");
    const fileCount = await getFileCount("", octokit, githubOwner, githubRepo);
    console.log("Done getting file count");
    return fileCount;
  } catch (err: any) {
    console.log("inside error block");
    if (err?.response?.status === 403 && err.message.includes("rate limit")) {
      throw new Error(
        "GitHub API rate limit exceeded. Please try again later.",
      );
    }
    throw err;
  }
};

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
  const token = githubToken?.trim() || process.env.GITHUB_TOKEN;
  console.log("githubToken =", githubToken);
  console.log(githubToken);
  console.log(".env token =", process.env.GITHUB_TOKEN);
  console.log("token = ", token);
  const docs = await loadGithubRepo(githubUrl, token);
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
  maxRetries = 4,
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
