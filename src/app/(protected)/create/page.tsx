"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useRefetch from "@/hooks/use-refetch";
// make sure that this is react, there's another api from server
import { api } from "@/trpc/react";
import { Info } from "lucide-react";
import React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

type FormInput = {
  repoUrl: string;
  projectName: string;
  githubToken?: string;
};

const CreatePage = () => {
  const { register, handleSubmit, reset, watch } = useForm<FormInput>({
    defaultValues: {
      githubToken: "", // ✅ this ensures it's never undefined
    },
  });

  const createProject = api.project.createProject.useMutation();
  const checkCredits = api.project.checkCredits.useMutation();
  const watchedRepoUrl = watch("repoUrl");
  const watchedProjectName = watch("projectName");
  const watchedToken = watch("githubToken");
  const refetch = useRefetch();

  React.useEffect(() => {
    if (checkCredits.data) {
      checkCredits.reset(); // clears previous data
    }
  }, [watchedRepoUrl, watchedProjectName, watchedToken]);
  function onSubmit(data: FormInput) {
    if (!!checkCredits.data) {
      createProject.mutate(
        {
          githubUrl: data.repoUrl,
          name: data.projectName,
          githubToken: data.githubToken,
        },
        {
          onSuccess: () => {
            toast.success("Project created successfully");
            refetch();
            reset();
          },
          onError: () => {
            toast.error("Failed to create project");
          },
        },
      );
    } else {
      checkCredits.mutate(
        {
          githubUrl: data.repoUrl,
          githubToken:
            data.githubToken?.trim() === ""
              ? undefined
              : data.githubToken?.trim(),
        },
        {
          onSuccess: (data) => {
            console.log("✅ checkCredits success", data);
          },
          onError: (error) => {
            console.error("❌ checkCredits error", error.message);
            toast.error(error.message || "Failed to check credits");
          },
        },
      );
    }
    return true;
  }

  const hasEnoughCredits = checkCredits?.data?.userCredits
    ? checkCredits.data.fileCount <= checkCredits.data.userCredits
    : true;
  return (
    <div className="flex h-full items-center justify-center gap-12">
      <img src="/undraw_github.svg" className="h-56 w-56" />
      <div>
        <div>
          <h1 className="text-2xl font-semibold">
            Link your Github Repository
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter the URL of your Repository to linkk it to CommitGenie
          </p>
        </div>
        <div className="h-4"></div>
        <div>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Input
              {...register("projectName", { required: true })}
              placeholder="Project Name"
              required
            />
            <div className="h-2"></div>
            <Input
              {...register("repoUrl", { required: true })}
              placeholder="Github URL"
              type="url"
              required
            />
            <div className="h-2"></div>
            <Input
              {...register("githubToken")}
              placeholder="Github Token (Optional)"
            />
            {createProject.isPending ? (
              <div className="mt-4 rounded-md border border-purple-200 bg-purple-50 px-4 py-2 text-purple-700">
                <div className="flex items-center gap-2">
                  <Info className="size-4" />
                  <p className="text-sm text-purple-600">
                    It might take a while to process all the files.
                  </p>
                </div>
              </div>
            ) : (
              !!checkCredits.data && (
                <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-orange-700">
                  <div className="flex items-center gap-2">
                    <Info className="size-4" />
                    <p className="text-sm">
                      You will be charged{" "}
                      <strong>{checkCredits.data?.fileCount}</strong> credits
                      for this repository.
                    </p>
                  </div>
                  <p className="ml-6 text-sm text-purple-600">
                    You have <strong>{checkCredits.data?.userCredits}</strong>{" "}
                    credits remaining.
                  </p>
                </div>
              )
            )}
            <div className="h-4"></div>
            <Button
              type="submit"
              disabled={
                createProject.isPending ||
                !!checkCredits.isPending ||
                !hasEnoughCredits
              }
            >
              {createProject.isPending
                ? "Creating Project "
                : !!checkCredits.data
                  ? "Create Project"
                  : "Check Credits"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreatePage;
