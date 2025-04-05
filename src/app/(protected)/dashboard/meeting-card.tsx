"use client";

import { Card } from "@/components/ui/card";
import { useDropzone } from "react-dropzone";
import React from "react";
import { uploadFile } from "@/lib/firebase";
import { Presentation, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import { api } from "@/trpc/react";
import useProject from "@/hooks/use-project";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";

const MeetingCard = () => {
  const { project } = useProject();
  const processMeeting = useMutation({
    mutationFn: async (data: {
      meetingUrl: string;
      meetingId: string;
      projectId: string;
    }) => {
      const { meetingUrl, meetingId, projectId } = data;
      const response = await axios.post("/api/process-meeting", {
        meetingUrl,
        meetingId,
        projectId,
      });
      return response.data;
    },
  });

  const [isUploading, setIsUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const router = useRouter();
  const uploadMeeting = api.project.uploadMeeting.useMutation();
  const checkCreditsForMeeting =
    api.project.checkCreditsForMeeting.useMutation();
  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      "audio/*": [".mp3", ".wav", ".m4a"],
    },
    multiple: false,
    maxSize: 40_000_000,
    onDrop: async (acceptedFiles) => {
      if (!project) return;
      setIsUploading(true);
      console.log(acceptedFiles);
      const file = acceptedFiles[0];
      if (!file) return;
      const check = await checkCreditsForMeeting.mutateAsync({
        fileSize: file.size,
      });
      if (check.userCredits < check.creditsRequired) {
        toast.error(
          `You need ${check.creditsRequired} credits to upload this file, but only have ${check.userCredits}.`,
        );
        setIsUploading(false);
        return;
      }
      const downloadURL = (await uploadFile(
        file as File,
        setProgress,
      )) as string;
      uploadMeeting.mutate(
        {
          projectId: project.id,
          meetingUrl: downloadURL,
          name: file.name,
        },
        {
          onSuccess: (meeting) => {
            toast.success("Meeting uploaded successfully");
            router.push("/meetings");
            processMeeting.mutateAsync({
              meetingUrl: downloadURL,
              meetingId: meeting.id,
              projectId: project.id,
            });
          },
          onError: () => {
            toast.error("Failed to upload meeting");
          },
        },
      );
      setIsUploading(false);
    },
    onDropRejected: (fileRejections) => {
      setIsUploading(false);
      for (const rejection of fileRejections) {
        for (const error of rejection.errors) {
          if (error.code === "file-too-large") {
            toast.error("File is too large. Maximum size is 40MB.");
          } else if (error.code === "file-invalid-type") {
            toast.error("Invalid file type. Please upload an audio file.");
          } else {
            toast.error(error.message);
          }
        }
      }
    },
  });

  return (
    <Card
      className="col-span-2 flex min-h-[250px] flex-col items-center justify-center p-10"
      {...getRootProps()}
    >
      {!isUploading && (
        <>
          <Presentation className="h-10 w-10 animate-bounce" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">
            Create a new meeting
          </h3>
          <p className="mt-1 text-center text-sm text-gray-500">
            Analyse your meeting with CommitGenie.
            <br />
            Powered by AI.
            <br />1 MB costs 1 credit.
          </p>
          <div className="mt-6">
            <Button
              disabled={isUploading || !!checkCreditsForMeeting.isPending}
            >
              <Upload className="-ml-0.5 mr-1.5 h-5 w-5" aria-hidden="true" />
              Upload Meeting
              <input className="hidden" {...getInputProps()} />
            </Button>
          </div>
        </>
      )}
      {isUploading && (
        <div className="h-20">
          <div className="h-4 w-64 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-violet-500 transition-all duration-300"
              style={{ width: `${100}%` }}
            />
          </div>
          <p className="mt-4 text-center text-sm text-gray-600">{100}%</p>
          <p className="mt-4 text-center text-sm text-gray-500">
            Uploading your meeting...
          </p>
        </div>
      )}
    </Card>
  );
};

export default MeetingCard;
