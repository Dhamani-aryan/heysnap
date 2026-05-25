export type UploadProgressState = {
  readonly title: string;
  readonly detail: string;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly phase: "preparing" | "uploading";
};

export type FeedbackSubmitState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" };
