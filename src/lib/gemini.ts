import { GoogleGenerativeAI } from "@google/generative-ai";
import { Document } from "@langchain/core/documents";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-lite",
});

export const aiSummariseCommit = async (diff: string) => {
  const response = await model.generateContent([
    `You are an expert programmer, and you are trying to summarize a git diff.
    Reminders about the git diff format:
    For every file, there are a few metadata lines, like (for example):
    \`\`\`
    diff --git a/lib/index.js b/lib/index.js
    index acadf891..bfef063 100644
    --- a/lib/index.js
    +++ b/lib/index.js
    \`\`\`
    This means that \`lib/index.js\` was modified in this commit. Note that this is only an example.
    Then there is a specifier of the lines that were modified.
    A line starting with \`+\` means it was added.
    A line starting with \`-\` means that line was deleted.
    A line that starts with neither \`+\` nor \`-\` is code given for context and better understanding.
    It is not part of the diff.

    EXAMPLE SUMMARY COMMENTS:
    \`\`\`
    * Raised the amount of returned recordings from \`10\` to \`100\` [packages/server/recordings_api.ts], [packages/server/constants.ts]
    * Fixed a typo in the github action name [.github/workflows/gpt-commit-summarizer.yml]
    * Moved the \`octokit\` initialization to a separate file [src/octokit.ts], [src/index.ts]
    * Added an OpenAI API for completions [packages/utils/apis/openai.ts]
    * Lowered numeric tolerance for test files
    \`\`\`
    Most commits will have less comments than this example's list.
    The last comment does not include the file names,
    because there were more than two relevant files in the hypothetical commit.
    Do not include parts of the example in your summary.
    It is given only as an example of appropriate comments.

    Please summarise the following diff file:

    \n\n${diff}
    `,
  ]);

  return response.response.text();
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 10000,
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

export async function summariseCode(doc: Document) {
  console.log("📄 Getting summary for", doc.metadata.source);

  const attemptSummarise = async () => {
    const code = doc.pageContent.slice(0, 10000);

    if (!code.trim()) {
      console.warn(`⚠️ Empty code content for ${doc.metadata.source}`);
      throw new Error("Empty code content");
    }

    const response = await model.generateContent([
      `You are an intelligent senior software engineer who specialises in onboarding junior software engineers onto projects.
      You are onboarding a junior software engineer and explaining to them the purpose of the ${doc.metadata.source} file.

      Here is the code:
      ---
      ${code}
      ---

      Give a summary no more than 100 words of the code above.`,
    ]);

    const summary = response.response.text();
    if (!summary.trim()) {
      throw new Error(`Empty summary generated for ${doc.metadata.source}`);
    }
    return summary;
  };

  return retryWithBackoff(() => attemptSummarise(), 3, 10000);
}

export async function generateEmbedding(summary: string) {
  const model = genAI.getGenerativeModel({
    model: "text-embedding-004",
  });

  const result = await model.embedContent(summary);
  const embedding = result.embedding;
  return embedding.values;
}

// console.log(
//   await summariseCommit(`diff --git a/prisma/schema.prisma b/prisma/schema.prisma
// index 5f4b263..c13c41b 100644
// --- a/prisma/schema.prisma
// +++ b/prisma/schema.prisma
// @@ -13,8 +13,8 @@ datasource db {

//  model User {
//    id          String  @id @default(cuid())
//    emailAddress String @unique
// -  firstName    String
// -  lastName     String
// +  firstName    String?
// +  lastName     String?
//    imageUrl     String?

//    stripeSubscriptionId String? @unique
//  }
// `),
// );
