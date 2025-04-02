import { api } from "@/trpc/react";
import React from "react";
import { useLocalStorage } from "usehooks-ts";

const useProject = () => {
  const { data: projects } = api.project.getProjects.useQuery();
  // similar to useState but it persists even after refreshing the tab as it is stored in localStorage
  const [projectId, setProjectId] = useLocalStorage("CommitGenie", "");
  const project = projects?.find((project) => project.id === projectId);
  return {
    projects,
    project,
    projectId,
    setProjectId,
  };
};

export default useProject;
