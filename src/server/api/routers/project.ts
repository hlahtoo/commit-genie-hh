import { z } from "zod";
// Zod is a TypeScript-first validation library.
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { pollCommits } from "@/lib/github";
import { checkCredits, indexGithubRepo } from "@/lib/github-loader";

export const projectRouter = createTRPCRouter({
  createProject: protectedProcedure
    .input(
      //z is the main object from Zod.
      // It has methods to define what your data should look like.
      z.object({
        name: z.string(), // No need to manually check if name exists, etc
        githubUrl: z.string(),
        githubToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.user.userId! },
        select: { credits: true },
      });

      if (!user) {
        throw new Error("User not found");
      }

      const currentCredits = user.credits || 0;
      const fileCount = await checkCredits(input.githubUrl, input.githubToken);

      if (currentCredits < fileCount) {
        throw new Error("Insufficient credits");
      }
      console.log("Got file count", fileCount);
      const project = await ctx.db.project.create({
        data: {
          githubUrl: input.githubUrl,
          name: input.name,
          userToProjects: {
            create: {
              userId: ctx.user.userId!,
            },
          },
        },
      });
      await indexGithubRepo(project.id, input.githubUrl, input.githubToken);
      console.log("completed index Githubrepo");
      await pollCommits(project.id);
      await ctx.db.user.update({
        where: { id: ctx.user.userId! },
        data: { credits: { decrement: fileCount } },
      });
      return project;
    }),
  getProjects: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.project.findMany({
      where: {
        userToProjects: {
          some: {
            userId: ctx.user.userId!,
          },
        },
        deletedAt: null,
      },
    });
  }),
  getCommits: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      pollCommits(input.projectId).then().catch(console.error);
      return await ctx.db.commit.findMany({
        where: { projectId: input.projectId },
      });
    }),
  saveAnswer: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        question: z.string(),
        answer: z.string(),
        filesReferences: z.any(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.question.create({
        data: {
          answer: input.answer,
          filesReferences: input.filesReferences,
          projectId: input.projectId,
          question: input.question,
          userId: ctx.user.userId!,
        },
      });
    }),

  getQuestions: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.question.findMany({
        where: {
          projectId: input.projectId,
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  uploadMeeting: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        meetingUrl: z.string(),
        name: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.create({
        data: {
          meetingUrl: input.meetingUrl,
          projectId: input.projectId,
          name: input.name,
          status: "PROCESSING",
        },
      });
      return meeting;
    }),

  getMeetings: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.meeting.findMany({
        where: { projectId: input.projectId },
        include: { issues: true },
      });
    }),

  deleteMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.meeting.delete({
        where: { id: input.meetingId },
      });
    }),

  getMeetingById: protectedProcedure
    .input(z.object({ meetingId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.meeting.findUnique({
        where: { id: input.meetingId },
        include: { issues: true },
      });
    }),

  archiveProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.project.update({
        where: { id: input.projectId },
        data: { deletedAt: new Date() },
      });
    }),

  getTeamMembers: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.userToProject.findMany({
        where: { projectId: input.projectId },
        include: { user: true },
      });
    }),

  getMyCredits: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.user.findUnique({
      where: { id: ctx.user.userId! },
      select: { credits: true },
    });
  }),
  checkCredits: protectedProcedure
    .input(
      z.object({ githubUrl: z.string(), githubToken: z.string().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const fileCount = await checkCredits(
          input.githubUrl,
          input.githubToken,
        );

        const userCredits = await ctx.db.user.findUnique({
          where: { id: ctx.user.userId! },
          select: { credits: true },
        });

        if (!userCredits) {
          throw new Error("User credits not found");
        }

        return {
          fileCount,
          userCredits: userCredits.credits || 0,
        };
      } catch (err: any) {
        console.error("❌ checkCredits mutation failed:", err.message);
        throw new Error(
          err.message.includes("rate limit")
            ? "GitHub API rate limit exceeded. Please try again later."
            : err.message || "Failed to check credits.",
        );
      }
    }),

  checkCreditsForMeeting: protectedProcedure
    .input(z.object({ fileSize: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.user.userId! },
        select: { credits: true },
      });

      if (!user) throw new Error("User not found");

      const creditsRequired = Math.ceil(input.fileSize / 1_000_000); // 1 credit per MB
      return {
        creditsRequired,
        userCredits: user.credits,
      };
    }),
});
